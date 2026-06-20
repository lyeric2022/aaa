import { NextResponse } from "next/server";
import { getFighter } from "@/lib/storage";
import { loadMovesForFighters, simulateFight } from "@/lib/arena";

export async function POST(req: Request) {
  const body = (await req.json()) as { fighter_a: string; fighter_b: string };

  const fighterA = await getFighter(body.fighter_a);
  const fighterB = await getFighter(body.fighter_b);

  if (!fighterA || !fighterB) {
    return NextResponse.json({ error: "Fighter not found" }, { status: 404 });
  }

  const moveMap = await loadMovesForFighters([fighterA, fighterB]);
  const result = await simulateFight(fighterA, fighterB, moveMap);
  return NextResponse.json(result);
}
