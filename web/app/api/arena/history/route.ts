import { NextResponse } from "next/server";
import { recentFights, recordFight } from "@/lib/moveMemory";
import type { FightRecordInput } from "@/lib/types";

// GET /api/arena/history?limit=20 — recent fights from the Redis history log.
export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 20;
  const fights = await recentFights(Math.max(1, Math.min(50, limit)));
  return NextResponse.json({ fights });
}

// POST /api/arena/history — record a finished fight (used by the live arena).
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<FightRecordInput>;
  if (!body.participants || body.participants.length !== 2) {
    return NextResponse.json(
      { error: "participants must be a pair of { id, name }" },
      { status: 400 },
    );
  }

  const entry = await recordFight({
    participants: body.participants,
    winner_id: body.winner_id ?? null,
    final_hp: body.final_hp,
    rounds: body.rounds,
    source: body.source ?? "live_arena",
    move_events: body.move_events,
  });

  if (!entry) {
    // Redis unavailable — history is a Redis-backed feature, so report it
    // without failing the caller's flow.
    return NextResponse.json({ recorded: false });
  }
  return NextResponse.json({ recorded: true, entry });
}
