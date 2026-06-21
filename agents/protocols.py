"""Internal Judge <-> Coach protocol.

This is the SEPARATE structured channel (NOT the chat protocol). It carries
typed pydantic Models so the two agents exchange machine-readable data instead
of free-form chat text. The chat protocol is reserved for the human / ASI:One
facing side of the Judge.

Both agents build a `Protocol(name=COACH_PROTOCOL_NAME, version=...)` using the
same name/version and the same Model schemas, which is what makes them
manifest-compatible on Agentverse.
"""

from __future__ import annotations

from uagents import Model

COACH_PROTOCOL_NAME = "ghost-fighter-move-fix"
COACH_PROTOCOL_VERSION = "1.0.0"

# Move-card stat dimensions, all floats in [0, 1].
STAT_KEYS = ["balance_risk", "smoothness", "recovery", "speed", "executability"]


class MoveFixRequest(Model):
    """Judge -> Coach. The Judge has decided a move is NOT deployable and asks
    the Coach for targeted fixes on the dimensions that failed."""

    request_id: str
    move_name: str
    failing_dims: list[str]
    stats: dict[str, float]
    judge_reasoning: str = ""


class MoveFixResponse(Model):
    """Coach -> Judge. One concrete remediation per failing dimension plus a
    short rollup the Judge can forward to the caller."""

    request_id: str
    fixes: dict[str, str]
    summary: str
