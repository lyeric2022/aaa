import { NextResponse } from "next/server";
import { getFighter } from "@/lib/storage";
import { loadMovesForFighters } from "@/lib/arena";
import { evaluateDeck } from "@/lib/enemy/evaluate";

// POST /api/arena/evaluate { fighter: <id>, matches?, seed? }
// Runs the fighter's deck against the full persona pool through the real arena
// and returns a competition-readiness profile.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    fighter: string;
    matches?: number;
    seed?: number;
  };

  const fighter = await getFighter(body.fighter);
  if (!fighter) {
    return NextResponse.json({ error: "Fighter not found" }, { status: 404 });
  }

  const moveMap = await loadMovesForFighters([fighter]);
  const profile = await evaluateDeck(fighter, moveMap, {
    matchesPerPersona: body.matches,
    baseSeed: body.seed,
  });
  return NextResponse.json(profile);
}
