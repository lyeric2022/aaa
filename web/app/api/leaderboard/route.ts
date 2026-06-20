import { NextResponse } from "next/server";
import { seedDemoMove, listMoves, listFighters } from "@/lib/storage";
import type { LeaderboardEntry } from "@/lib/types";

export async function GET() {
  await seedDemoMove();
  const [moves, fighters] = await Promise.all([listMoves(), listFighters()]);

  const moveEntries: LeaderboardEntry[] = moves
    .filter((m) => m.move_card.verdict !== "pending")
    .map((m) => ({
      id: m.move_card.id,
      name: m.move_card.name,
      score: m.move_card.stats.deployability,
      type: "move" as const,
      verdict: m.move_card.verdict,
    }))
    .sort((a, b) => b.score - a.score);

  const fighterEntries: LeaderboardEntry[] = fighters
    .map((f) => ({
      id: f.id,
      name: f.name,
      score: f.stats.deployability,
      type: "fighter" as const,
    }))
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({ moves: moveEntries, fighters: fighterEntries });
}
