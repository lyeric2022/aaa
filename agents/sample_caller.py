"""Local smoke-test client for the Judge agent (no ASI:One mailbox needed).

Sends a deliberately unsafe move card over the chat protocol and prints the
Judge's reply (which should come back coached by the Coach). Set JUDGE_ADDRESS
in your .env to the address printed by judge_agent.py.

    python sample_caller.py
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)

load_dotenv()

JUDGE_ADDRESS = os.getenv("JUDGE_ADDRESS", "")

caller = Agent(name="ghost-fighter-caller", port=8003, mailbox=True)

UNSAFE_CARD = {
    "name": "ghost_spin_kick",
    "stats": {
        "balance_risk": 0.82,   # > 0.7 -> hard safety fail
        "smoothness": 0.45,
        "recovery": 0.25,       # < 0.3 -> hard safety fail
        "speed": 0.7,
        "executability": 0.4,
    },
}


@caller.on_event("startup")
async def send_card(ctx: Context):
    if not JUDGE_ADDRESS:
        ctx.logger.error("Set JUDGE_ADDRESS in .env to the Judge's agent address.")
        return
    await ctx.send(
        JUDGE_ADDRESS,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[TextContent(type="text", text=json.dumps(UNSAFE_CARD))],
        ),
    )
    ctx.logger.info("Sent unsafe move card to Judge.")


@caller.on_message(ChatMessage)
async def on_reply(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id),
    )
    for item in msg.content:
        if isinstance(item, TextContent):
            ctx.logger.info(f"\n--- Judge reply ---\n{item.text}\n-------------------")


@caller.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.debug(f"Ack from {sender}")


if __name__ == "__main__":
    print(f"Caller agent address: {caller.address}")
    caller.run()
