"""Ghost Fighter COACH agent.

Given the failing dimensions of a move card (sent by the Judge over the
internal structured protocol), returns one targeted, concrete fix per failing
dimension via ASI:One.

Two interfaces:
  * Internal structured protocol  -> MoveFixRequest / MoveFixResponse (Judge<->Coach)
  * Chat protocol                 -> so a human / ASI:One can also talk to the
                                     Coach directly for ad-hoc coaching.
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
COACH_SEED = os.getenv("COACH_SEED", "ghost-fighter-coach-seed-change-me")
COACH_PORT = int(os.getenv("COACH_PORT", "8002"))
ASI_MODEL = "asi1-mini"

client = OpenAI(base_url="https://api.asi1.ai/v1", api_key=ASI_API_KEY)

agent = Agent(
    name="ghost-fighter-coach",
    seed=COACH_SEED,
    port=COACH_PORT,
    mailbox=True,
    publish_agent_details=True,
)

COACH_SYSTEM_PROMPT = (
    "You are a robotics motion coach for a humanoid robot-sports platform. "
    "Move cards have these dimensions, all floats 0-1: balance_risk (higher is "
    "worse), smoothness, recovery, speed, executability. You are given the move "
    "stats and the list of FAILING dimensions. For EACH failing dimension, give "
    "ONE concrete, physically-actionable fix the creator can apply to the motion "
    "(e.g. 'widen stance 10cm before the spin', 'add 150ms settle frames after "
    "the strike'). Be specific and brief. "
    "Respond with ONLY a JSON object: "
    '{"fixes": {"<dim>": "<fix>", ...}, "summary": "<one sentence rollup>"}. '
    "Include a key in fixes for every failing dimension."
)


def _fallback_fixes(failing_dims: list[str]) -> dict[str, str]:
    canned = {
        "balance_risk": "Lower the center of mass and widen the support base before the fastest segment.",
        "smoothness": "Add interpolation/ease-in frames to remove the velocity spikes between key poses.",
        "recovery": "Append settle frames so the robot returns to a stable neutral stance at the end.",
        "speed": "Re-time the segment so peak speed stays within the actuator velocity limits.",
        "executability": "Reduce joint extension toward the limits and re-target onto the G1 joint ranges.",
    }
    return {d: canned.get(d, "Reduce the magnitude on this dimension and re-test in sim.") for d in failing_dims}


async def _coach_llm(move_name: str, failing_dims: list[str], stats: dict) -> tuple[dict[str, str], str]:
    """Call ASI:One for targeted fixes. Falls back to canned advice on any error
    so the agent never hard-fails during a demo."""
    if not failing_dims:
        return {}, "No failing dimensions: the move is already clean."

    user_payload = json.dumps({"move_name": move_name, "failing_dims": failing_dims, "stats": stats})
    try:
        resp = await asyncio.to_thread(
            client.chat.completions.create,
            model=ASI_MODEL,
            messages=[
                {"role": "system", "content": COACH_SYSTEM_PROMPT},
                {"role": "user", "content": user_payload},
            ],
            temperature=0.3,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip ```json fences if the model adds them.
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        data = json.loads(raw)
        fixes = {d: str(data.get("fixes", {}).get(d, _fallback_fixes([d])[d])) for d in failing_dims}
        summary = str(data.get("summary", "Targeted fixes generated for the failing dimensions."))
        return fixes, summary
    except Exception as exc:  # noqa: BLE001 - demo resilience
        return _fallback_fixes(failing_dims), f"(LLM unavailable: {exc}) Applied default remediation."


# ---------------------------------------------------------------------------
# Internal structured channel (Judge -> Coach -> Judge)
# ---------------------------------------------------------------------------
fix_proto = Protocol(name=COACH_PROTOCOL_NAME, version=COACH_PROTOCOL_VERSION)


@fix_proto.on_message(MoveFixRequest, replies=MoveFixResponse)
async def handle_fix_request(ctx: Context, sender: str, msg: MoveFixRequest):
    ctx.logger.info(f"Coaching '{msg.move_name}' on failing dims: {msg.failing_dims}")
    fixes, summary = await _coach_llm(msg.move_name, msg.failing_dims, msg.stats)
    await ctx.send(
        sender,
        MoveFixResponse(request_id=msg.request_id, fixes=fixes, summary=summary),
    )


# ---------------------------------------------------------------------------
# Chat protocol (optional direct human / ASI:One access to the Coach)
# ---------------------------------------------------------------------------
chat_proto = Protocol(spec=chat_protocol_spec)


def _chat(text: str, end: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
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

    # Try to read a JSON move card from the chat; otherwise coach all dims.
    failing = list(STAT_KEYS)
    stats: dict[str, float] = {}
    move_name = "move"
    try:
        data = json.loads(text)
        stats = data.get("stats", data)
        move_name = data.get("move_name", data.get("name", "move"))
        failing = data.get("failing_dims") or [k for k in STAT_KEYS if k in stats]
    except json.JSONDecodeError:
        pass

    fixes, summary = await _coach_llm(move_name, failing, stats)
    lines = [f"Coaching for **{move_name}**:", summary, ""]
    lines += [f"- **{dim}**: {fix}" for dim, fix in fixes.items()]
    await ctx.send(sender, _chat("\n".join(lines), end=True))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.debug(f"Chat ack from {sender} for {msg.acknowledged_msg_id}")


agent.include(fix_proto, publish_manifest=True)
agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"Coach agent address: {agent.address}")
    agent.run()
