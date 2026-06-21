"""Shared scoring + coaching logic for Ghost Fighter.

This module holds the PURE judge/coach logic so it can be reused by:
  * judge_agent.py  (the chat-facing uAgent)
  * coach_agent.py  (the coaching uAgent)
  * web_bridge.py   (the HTTP bridge the web frontend POSTs to)

Importing this module has NO side effects (no Agent is created, no mailbox /
Almanac network calls). The OpenAI/ASI:One client is created lazily on first
use so importers that never call the LLM stay cheap.
"""

from __future__ import annotations

import asyncio
import json
import os

from openai import OpenAI

# Move-card stat dimensions, all floats in [0, 1]. Defined here (not in
# protocols.py) so non-agent callers like web_bridge.py can import the scoring
# logic WITHOUT pulling in uagents/cosmpy (which conflicts with protobuf under
# `uvicorn --reload`).
STAT_KEYS = ["balance_risk", "smoothness", "recovery", "speed"]

ASI_MODEL = "asi1-mini"

# Safety thresholds (hard gate) and soft thresholds (failing-dim detection).
BALANCE_RISK_MAX = 0.7
RECOVERY_MIN = 0.3
SOFT_MIN = 0.5  # smoothness floor
SPEED_MIN = 0.2

_client: OpenAI | None = None


def get_client() -> OpenAI:
    """Lazily build the ASI:One OpenAI-compatible client from the environment."""
    global _client
    if _client is None:
        _client = OpenAI(base_url="https://api.asi1.ai/v1", api_key=os.getenv("ASI_API_KEY"))
    return _client


JUDGE_SYSTEM_PROMPT = (
    "You are the deployability judge for a humanoid robot-sports platform. "
    "Move-card stats are floats 0-1: balance_risk (higher is worse), smoothness, "
    "recovery, speed. Give a nuanced overall judgment of whether the move is safe "
    "and clean enough to deploy to a real humanoid, plus a SHORT human-readable "
    "explanation. "
    "Respond with ONLY JSON: "
    '{"deployable": <bool>, "score": <float 0-1>, "reasoning": "<2-3 sentences>"}.'
)

COACH_SYSTEM_PROMPT = (
    "You are a robotics motion coach for a humanoid robot-sports platform. "
    "Move cards have these dimensions, all floats 0-1: balance_risk (higher is "
    "worse), smoothness, recovery, speed. You are given the move stats and the "
    "list of FAILING dimensions. For EACH failing dimension, give ONE concrete, "
    "physically-actionable fix the creator can apply to the motion (e.g. 'widen "
    "stance 10cm before the spin', 'add 150ms settle frames after the strike'). "
    "Be specific and brief. "
    "Respond with ONLY a JSON object: "
    '{"fixes": {"<dim>": "<fix>", ...}, "summary": "<one sentence rollup>"}. '
    "Include a key in fixes for every failing dimension."
)


# ---------------------------------------------------------------------------
# Deterministic helpers
# ---------------------------------------------------------------------------
def normalize_stats(raw: dict) -> dict[str, float]:
    """Coerce a stats dict to {key: float in [0,1]}. Accepts 0-100 scale inputs
    (like the repo's existing move_cards/*.json) by auto-dividing by 100."""
    out: dict[str, float] = {}
    for k in STAT_KEYS:
        v = raw.get(k)
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f > 1.0:  # looks like a 0-100 value
            f = f / 100.0
        out[k] = max(0.0, min(1.0, f))
    return out


def safety_gate(stats: dict[str, float]) -> list[str]:
    """Return the HARD safety failures. Non-overridable by the LLM."""
    failures = []
    if stats.get("balance_risk", 0.0) > BALANCE_RISK_MAX:
        failures.append("balance_risk")
    if stats.get("recovery", 1.0) < RECOVERY_MIN:
        failures.append("recovery")
    return failures


def soft_failing_dims(stats: dict[str, float]) -> list[str]:
    """Threshold-based detection of weaker (non-safety-critical) dimensions."""
    fails = []
    if stats.get("smoothness", 1.0) < SOFT_MIN:
        fails.append("smoothness")
    if stats.get("speed", 1.0) < SPEED_MIN:
        fails.append("speed")
    return fails


def build_verdict(stats: dict[str, float], llm_deployable: bool, llm_score: float, reasoning: str) -> dict:
    """Combine the safety gate with the LLM judgment. Safety failures force a
    non-deployable verdict and cap the score."""
    hard = safety_gate(stats)
    soft = soft_failing_dims(stats)
    failing_dims = list(dict.fromkeys(hard + soft))  # dedupe, keep order

    if hard:
        deployable = False
        score = min(llm_score, 0.25)
        reasoning = f"SAFETY GATE failed on {', '.join(hard)} (non-overridable). " + reasoning
    else:
        deployable = llm_deployable and not failing_dims
        score = llm_score

    # A non-deployable verdict must always give the Coach something to work on.
    # If the LLM rejected the move but no threshold flagged a dim, fall back to
    # the single weakest dimension by concern (balance_risk high=bad, others low=bad).
    if not deployable and not failing_dims:
        concern = {}
        if "balance_risk" in stats:
            concern["balance_risk"] = stats["balance_risk"]
        for k in ("smoothness", "recovery", "speed"):
            if k in stats:
                concern[k] = 1.0 - stats[k]
        if concern:
            failing_dims = [max(concern, key=concern.get)]

    return {
        "deployable": deployable,
        "score": round(float(score), 3),
        "failing_dims": failing_dims,
        "reasoning": reasoning,
    }


def fallback_fixes(failing_dims: list[str]) -> dict[str, str]:
    canned = {
        "balance_risk": "Lower the center of mass and widen the support base before the fastest segment.",
        "smoothness": "Add interpolation/ease-in frames to remove the velocity spikes between key poses.",
        "recovery": "Append settle frames so the robot returns to a stable neutral stance at the end.",
        "speed": "Re-time the segment so peak speed stays within the actuator velocity limits.",
    }
    return {d: canned.get(d, "Reduce the magnitude on this dimension and re-test in sim.") for d in failing_dims}


# ---------------------------------------------------------------------------
# LLM calls (ASI:One)
# ---------------------------------------------------------------------------
def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    return raw


async def judge_llm(stats: dict[str, float]) -> tuple[bool, float, str]:
    """Nuanced judgment from ASI:One. Falls back to a deterministic estimate on
    any error so the system stays runnable during a demo."""
    try:
        resp = await asyncio.to_thread(
            get_client().chat.completions.create,
            model=ASI_MODEL,
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({"stats": stats})},
            ],
            temperature=0.2,
        )
        data = json.loads(_strip_fences(resp.choices[0].message.content))
        return bool(data["deployable"]), float(data["score"]), str(data["reasoning"])
    except Exception as exc:  # noqa: BLE001 - demo resilience
        good = [stats.get(k, 0.5) for k in ("smoothness", "recovery", "speed")]
        score = max(0.0, min(1.0, sum(good) / len(good) - stats.get("balance_risk", 0.5) * 0.5))
        return score >= 0.6, round(score, 3), f"(LLM unavailable: {exc}) Heuristic score used."


async def coach_llm(move_name: str, failing_dims: list[str], stats: dict) -> tuple[dict[str, str], str]:
    """Targeted fixes from ASI:One. Falls back to canned advice on any error."""
    if not failing_dims:
        return {}, "No failing dimensions: the move is already clean."

    user_payload = json.dumps({"move_name": move_name, "failing_dims": failing_dims, "stats": stats})
    try:
        resp = await asyncio.to_thread(
            get_client().chat.completions.create,
            model=ASI_MODEL,
            messages=[
                {"role": "system", "content": COACH_SYSTEM_PROMPT},
                {"role": "user", "content": user_payload},
            ],
            temperature=0.3,
        )
        data = json.loads(_strip_fences(resp.choices[0].message.content))
        fixes = {d: str(data.get("fixes", {}).get(d, fallback_fixes([d])[d])) for d in failing_dims}
        summary = str(data.get("summary", "Targeted fixes generated for the failing dimensions."))
        return fixes, summary
    except Exception as exc:  # noqa: BLE001 - demo resilience
        return fallback_fixes(failing_dims), f"(LLM unavailable: {exc}) Applied default remediation."


# ---------------------------------------------------------------------------
# Full orchestration (judge -> coach) for non-agent callers (the web bridge)
# ---------------------------------------------------------------------------
async def evaluate(name: str, raw_stats: dict) -> dict:
    """Run the same Judge -> Coach flow the agents run, but synchronously and
    in-process. Returns a single combined result dict."""
    stats = normalize_stats(raw_stats)
    llm_deployable, llm_score, reasoning = await judge_llm(stats)
    verdict = build_verdict(stats, llm_deployable, llm_score, reasoning)

    result = {"move_name": name, "normalized_stats": stats, **verdict}
    if not verdict["deployable"] and verdict["failing_dims"]:
        fixes, summary = await coach_llm(name, verdict["failing_dims"], stats)
        result["coach_summary"] = summary
        result["fixes"] = fixes
    return result
