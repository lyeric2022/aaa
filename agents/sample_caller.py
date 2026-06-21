"""Local smoke-test client for the Judge agent (no ASI:One mailbox needed).

Sends a move card over the chat protocol and prints the Judge's reply (which
comes back coached by the Coach). Set JUDGE_ADDRESS in your .env to the address
printed by judge_agent.py.

    # built-in unsafe sample
    python sample_caller.py

    # a REAL move card from the repo
    python sample_caller.py ../move_cards/ghost_jab_combo.json
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
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
    },
}


def load_card(path: str) -> dict:
    """Read a move_cards/*.json file and pull out the {name, stats} the Judge
    needs. Handles the repo layout where the usable stats live under
    `move_card.stats` (0-100 scale; the Judge normalizes that automatically)."""
    data = json.loads(Path(path).read_text())
    card = data.get("move_card", data)
    stats = card.get("stats", {})
    name = card.get("name") or card.get("id") or Path(path).stem
    return {"name": name, "stats": stats}


CARD = load_card(sys.argv[1]) if len(sys.argv) > 1 else UNSAFE_CARD


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
            content=[TextContent(type="text", text=json.dumps(CARD))],
        ),
    )
    ctx.logger.info(f"Sent move card '{CARD['name']}' to Judge.")


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
