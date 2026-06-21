import { listMoves, listFighters } from "./storage";
import { leaderboardFighters, leaderboardMoves } from "./moveMemory";
import type { LeaderboardEntry } from "./types";

/**
 * Move + fighter leaderboards. Reads from the Redis sorted sets when the
 * move-memory layer is available, and otherwise ranks the filesystem records
 * in-process so the board still renders without Redis.
 */
export async function getLeaderboards(limit = 25): Promise<{
  moves: LeaderboardEntry[];
  fighters: LeaderboardEntry[];
}> {
  const [redisMoves, redisFighters] = await Promise.all([
    leaderboardMoves(limit),
    leaderboardFighters(limit),
  ]);

  if (redisMoves && redisFighters) {
    return { moves: redisMoves, fighters: redisFighters };
  }

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
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const fighterEntries: LeaderboardEntry[] = fighters
    .map((f) => ({
      id: f.id,
      name: f.name,
      score: f.stats.deployability,
      type: "fighter" as const,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { moves: moveEntries, fighters: fighterEntries };
}
