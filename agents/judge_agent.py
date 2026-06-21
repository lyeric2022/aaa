"""Ghost Fighter JUDGE agent.

Decides whether a move card is deployable to a humanoid robot using a HYBRID
design:

  1. DETERMINISTIC SAFETY GATE first. If balance_risk > 0.7 OR recovery < 0.3
     the move auto-fails. The LLM cannot override this.
  2. ASI:One is then used only for the nuanced overall judgment + a short
     human-readable explanation.

Flow:
  move card (chat / ASI:One)
    -> Judge acks, parses stats, runs safety gate + LLM
    -> if NOT deployable: send failing_dims+stats to Coach (structured protocol)
       -> Coach replies with fixes
       -> Judge forwards combined verdict+fixes back to the original caller
    -> if deployable: Judge replies immediately.

Output verdict shape:
  {deployable: bool, score: float, failing_dims: [str], reasoning: str}
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
from openai import OpenAI

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from protocols import (
    COACH_PROTOCOL_NAME,
    COACH_PROTOCOL_VERSION,
    STAT_KEYS,
    MoveFixRequest,
    MoveFixResponse,
)

load_dotenv()

ASI_API_KEY = os.getenv("ASI_API_KEY")
JUDGE_SEED = os.getenv("JUDGE_SEED", "ghost-fighter-judge-seed-change-me")
JUDGE_PORT = int(os.getenv("JUDGE_PORT", "8001"))
COACH_ADDRESS = os.getenv("COACH_ADDRESS", "")  # set to the Coach's agent1q... address
ASI_MODEL = "asi1-mini"

# Safety thresholds (hard gate) and soft thresholds (failing-dim detection).
BALANCE_RISK_MAX = 0.7
RECOVERY_MIN = 0.3
SOFT_MIN = 0.5  # smoothness / executability floor
SPEED_MIN = 0.2

client = OpenAI(base_url="https://api.asi1.ai/v1", api_key=ASI_API_KEY)

agent = Agent(
    name="ghost-fighter-judge",
    seed=JUDGE_SEED,
    port=JUDGE_PORT,
    mailbox=True,
    publish_agent_details=True,
)

JUDGE_SYSTEM_PROMPT = (
    "You are the deployability judge for a humanoid robot-sports platform. "
    "Move-card stats are floats 0-1: balance_risk (higher is worse), smoothness, "
    "recovery, speed, executability. Give a nuanced overall judgment of whether "
    "the move is safe and clean enough to deploy to a real humanoid, plus a SHORT "
    "human-readable explanation. "
    "Respond with ONLY JSON: "
    '{"deployable": <bool>, "score": <float 0-1>, "reasoning": "<2-3 sentences>"}.'
)


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
    if stats.get("executability", 1.0) < SOFT_MIN:
        fails.append("executability")
    if stats.get("speed", 1.0) < SPEED_MIN:
        fails.append("speed")
    return fails


async def judge_llm(stats: dict[str, float]) -> tuple[bool, float, str]:
    """Nuanced judgment from ASI:One. Falls back to a deterministic estimate on
    any error so the agent stays runnable during a demo."""
    try:
        resp = await asyncio.to_thread(
            client.chat.completions.create,
            model=ASI_MODEL,
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({"stats": stats})},
            ],
            temperature=0.2,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        data = json.loads(raw)
        return bool(data["deployable"]), float(data["score"]), str(data["reasoning"])
    except Exception as exc:  # noqa: BLE001 - demo resilience
        # Deterministic fallback score: reward good dims, punish balance_risk.
        good = [stats.get(k, 0.5) for k in ("smoothness", "recovery", "speed", "executability")]
        score = max(0.0, min(1.0, sum(good) / len(good) - stats.get("balance_risk", 0.5) * 0.5))
        return score >= 0.6, round(score, 3), f"(LLM unavailable: {exc}) Heuristic score used."


def build_verdict(stats: dict[str, float], llm_deployable: bool, llm_score: float, reasoning: str):
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

    return {
        "deployable": deployable,
        "score": round(float(score), 3),
        "failing_dims": failing_dims,
        "reasoning": reasoning,
    }


def parse_move_card(text: str) -> tuple[str, dict[str, float]] | None:
    """Extract (move_name, normalized_stats) from a JSON chat payload. Accepts
    either a bare stats object or a full move card with a nested 'stats' key.

    ASI:One/Agentverse chats may prepend routing text such as "@agent1q...".
    If the full message is not valid JSON, extract the JSON object inside it.
    """
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    raw_stats = data.get("stats", data) if isinstance(data, dict) else {}
    stats = normalize_stats(raw_stats if isinstance(raw_stats, dict) else {})
    if not stats:
        return None
    name = data.get("name") or data.get("id") or data.get("move_name") or "move"
    return str(name), stats


# ---------------------------------------------------------------------------
# Chat protocol (human / ASI:One facing)
# ---------------------------------------------------------------------------
chat_proto = Protocol(spec=chat_protocol_spec)


def _chat(text: str, end: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)


def _format_verdict(move_name: str, verdict: dict) -> str:
    status = "DEPLOYABLE ✅" if verdict["deployable"] else "NOT deployable ❌"
    lines = [
        f"**{move_name}** — {status}",
        f"score: {verdict['score']}",
    ]
    if verdict["failing_dims"]:
        lines.append(f"failing dims: {', '.join(verdict['failing_dims'])}")
    lines.append(f"reasoning: {verdict['reasoning']}")
    return "\n".join(lines)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    # 1) Always acknowledge first.
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id),
    )

    text = ""
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            continue
        if isinstance(item, TextContent):
            text += item.text

    if not text.strip():
        return

    parsed = parse_move_card(text)
    if parsed is None:
        await ctx.send(
            sender,
            _chat(
                "Send a move card as JSON with stats (balance_risk, smoothness, "
                "recovery, speed, executability) as floats 0-1, e.g. "
                '{"name":"ghost_jab","stats":{"balance_risk":0.8,"smoothness":0.6,'
                '"recovery":0.2,"speed":0.7,"executability":0.5}}',
                end=True,
            ),
        )
        return

    move_name, stats = parsed
    llm_deployable, llm_score, reasoning = await judge_llm(stats)
    verdict = build_verdict(stats, llm_deployable, llm_score, reasoning)
    ctx.logger.info(f"Verdict for {move_name}: {verdict}")

    # Deployable -> answer immediately.
    if verdict["deployable"]:
        await ctx.send(sender, _chat(_format_verdict(move_name, verdict), end=True))
        return

    # Not deployable -> route to Coach over the structured channel.
    if not COACH_ADDRESS:
        await ctx.send(
            sender,
            _chat(
                _format_verdict(move_name, verdict)
                + "\n\n(Coach unavailable: COACH_ADDRESS not configured.)",
                end=True,
            ),
        )
        return

    request_id = uuid4().hex
    # Stash the caller + verdict so we can reply when the Coach answers.
    ctx.storage.set(
        request_id,
        json.dumps({"sender": sender, "move_name": move_name, "verdict": verdict}),
    )
    await ctx.send(
        COACH_ADDRESS,
        MoveFixRequest(
            request_id=request_id,
            move_name=move_name,
            failing_dims=verdict["failing_dims"],
            stats=stats,
            judge_reasoning=verdict["reasoning"],
        ),
    )
    ctx.logger.info(f"Routed {move_name} to Coach (req {request_id}).")


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.debug(f"Chat ack from {sender} for {msg.acknowledged_msg_id}")


# ---------------------------------------------------------------------------
# Internal structured channel: receive the Coach's fixes, finish the reply.
# ---------------------------------------------------------------------------
fix_proto = Protocol(name=COACH_PROTOCOL_NAME, version=COACH_PROTOCOL_VERSION)


@fix_proto.on_message(MoveFixResponse)
async def handle_fix_response(ctx: Context, sender: str, msg: MoveFixResponse):
    stored = ctx.storage.get(msg.request_id)
    if not stored:
        ctx.logger.warning(f"No pending request for {msg.request_id}")
        return
    ctx.storage.remove(msg.request_id)

    ctx_data = json.loads(stored)
    caller = ctx_data["sender"]
    move_name = ctx_data["move_name"]
    verdict = ctx_data["verdict"]

    parts = [_format_verdict(move_name, verdict), "", f"Coach: {msg.summary}"]
    parts += [f"- **{dim}**: {fix}" for dim, fix in msg.fixes.items()]
    await ctx.send(caller, _chat("\n".join(parts), end=True))
    ctx.logger.info(f"Returned coached verdict for {move_name} to {caller}.")


agent.include(chat_proto, publish_manifest=True)
agent.include(fix_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"Judge agent address: {agent.address}")
    agent.run()
