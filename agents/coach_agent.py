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

import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from core import coach_llm
from protocols import (
    COACH_PROTOCOL_NAME,
    COACH_PROTOCOL_VERSION,
    STAT_KEYS,
    MoveFixRequest,
    MoveFixResponse,
)

load_dotenv()

COACH_SEED = os.getenv("COACH_SEED", "ghost-fighter-coach-seed-change-me")
COACH_PORT = int(os.getenv("COACH_PORT", "8002"))

agent = Agent(
    name="ghost-fighter-coach",
    seed=COACH_SEED,
    port=COACH_PORT,
    mailbox=True,
    publish_agent_details=True,
)


# ---------------------------------------------------------------------------
# Internal structured channel (Judge -> Coach -> Judge)
# ---------------------------------------------------------------------------
fix_proto = Protocol(name=COACH_PROTOCOL_NAME, version=COACH_PROTOCOL_VERSION)


@fix_proto.on_message(MoveFixRequest, replies=MoveFixResponse)
async def handle_fix_request(ctx: Context, sender: str, msg: MoveFixRequest):
    ctx.logger.info(f"Coaching '{msg.move_name}' on failing dims: {msg.failing_dims}")
    fixes, summary = await coach_llm(msg.move_name, msg.failing_dims, msg.stats)
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

    fixes, summary = await coach_llm(move_name, failing, stats)
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
