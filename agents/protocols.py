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

from core import STAT_KEYS  # re-exported; single source of truth lives in core

COACH_PROTOCOL_NAME = "ghost-fighter-move-fix"
COACH_PROTOCOL_VERSION = "1.0.0"
WEB_JUDGE_PROTOCOL_NAME = "ghost-fighter-web-judge"
WEB_JUDGE_PROTOCOL_VERSION = "1.0.0"

__all__ = [
    "STAT_KEYS",
    "COACH_PROTOCOL_NAME",
    "COACH_PROTOCOL_VERSION",
    "WEB_JUDGE_PROTOCOL_NAME",
    "WEB_JUDGE_PROTOCOL_VERSION",
    "MoveFixRequest",
    "MoveFixResponse",
    "WebJudgeRequest",
    "WebJudgeResponse",
]


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


class WebJudgeRequest(Model):
    """Web bridge -> Judge. Structured request/response entry point for Next.js."""

    request_id: str
    move_name: str
    stats: dict[str, float]


class WebJudgeResponse(Model):
    """Judge -> web bridge. Same shape the frontend displays."""

    request_id: str
    move_name: str
    normalized_stats: dict[str, float]
    deployable: bool
    score: float
    failing_dims: list[str]
    reasoning: str
    coach_summary: str | None = None
    fixes: dict[str, str] | None = None
    error: str | None = None
