import { v4 as uuidv4 } from "uuid";
import { getRedis } from "./redis";
import type {
  Fighter,
  FightHistoryEntry,
  FightRecordInput,
  FighterPerformance,
  LeaderboardEntry,
  MovePerformance,
  MoveRecord,
  MoveStats,
  SimilarMove,
} from "./types";

// Redis key layout for the move-memory layer.
//   move:{id}            -> JSON MoveRecord
//   moves:index          -> ZSET (score = created_at ms) of move ids
//   moves:vectors        -> HASH id -> JSON feature vector (similarity search)
//   lb:moves             -> ZSET (score = deployability) of move ids
//   fighter:{id}         -> JSON Fighter
//   fighters:index       -> ZSET (score = created_at ms) of fighter ids
//   lb:fighters          -> ZSET (score = deployability) of fighter ids
//   move:{id}:perf       -> HASH historical performance counters
//   fighter:{id}:perf    -> HASH historical performance counters
//   fights:recent        -> LIST (newest first) of JSON FightHistoryEntry
const K = {
  move: (id: string) => `move:${id}`,
  movesIndex: "moves:index",
  movesVectors: "moves:vectors",
  lbMoves: "lb:moves",
  fighter: (id: string) => `fighter:${id}`,
  fightersIndex: "fighters:index",
  lbFighters: "lb:fighters",
  movePerf: (id: string) => `move:${id}:perf`,
  fighterPerf: (id: string) => `fighter:${id}:perf`,
  fightsRecent: "fights:recent",
};

const RECENT_FIGHTS_MAX = 50;

/** Whether the Redis move-memory layer is currently usable. */
export async function memoryEnabled(): Promise<boolean> {
  return (await getRedis()) !== null;
}

// --- Feature vectors & similarity ------------------------------------------

/** A move's stats projected to a normalized 6-D feature vector in [0, 1]. */
export function featureVector(stats: MoveStats): number[] {
  return [
    stats.speed,
    stats.power,
    stats.smoothness,
    stats.balance_risk,
    stats.recovery,
    stats.deployability,
  ].map((v) => Math.max(0, Math.min(1, v / 100)));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- Moves ------------------------------------------------------------------

export async function saveMoveMemory(record: MoveRecord): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  const card = record.move_card;
  const createdMs = new Date(card.created_at).getTime() || Date.now();

  const tx = redis.multi();
  tx.set(K.move(card.id), JSON.stringify(record));
  tx.zAdd(K.movesIndex, [{ score: createdMs, value: card.id }]);
  tx.hSet(K.movesVectors, card.id, JSON.stringify(featureVector(card.stats)));
  // Pending moves aren't ranked until they've been scored.
  if (card.verdict !== "pending") {
    tx.zAdd(K.lbMoves, [{ score: card.stats.deployability, value: card.id }]);
  } else {
    tx.zRem(K.lbMoves, card.id);
  }
  await tx.exec();
  return true;
}

export async function getMoveMemory(id: string): Promise<MoveRecord | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(K.move(id));
  return raw ? (JSON.parse(raw) as MoveRecord) : null;
}

export async function listMovesMemory(): Promise<MoveRecord[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  // Newest first.
  const ids = await redis.zRange(K.movesIndex, 0, -1, { REV: true });
  if (!ids.length) return [];
  const raws = await redis.mGet(ids.map(K.move));
  return raws
    .filter((r): r is string => Boolean(r))
    .map((r) => JSON.parse(r) as MoveRecord);
}

/** Top-k moves most similar to `id` by feature-vector cosine similarity. */
export async function similarMoves(id: string, k = 5): Promise<SimilarMove[]> {
  const redis = await getRedis();
  if (!redis) return [];

  const targetRaw = await redis.hGet(K.movesVectors, id);
  if (!targetRaw) return [];
  const target = JSON.parse(targetRaw) as number[];

  const vectors = await redis.hGetAll(K.movesVectors);
  const ranked = Object.entries(vectors)
    .filter(([otherId]) => otherId !== id)
    .map(([otherId, raw]) => ({
      id: otherId,
      similarity: cosineSimilarity(target, JSON.parse(raw) as number[]),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  if (!ranked.length) return [];
  const records = await redis.mGet(ranked.map((r) => K.move(r.id)));
  const out: SimilarMove[] = [];
  ranked.forEach((r, i) => {
    const raw = records[i];
    if (!raw) return;
    const card = (JSON.parse(raw) as MoveRecord).move_card;
    out.push({
      id: card.id,
      name: card.name,
      similarity: Math.round(r.similarity * 1000) / 1000,
      attack_type: card.attack_type,
      verdict: card.verdict,
      deployability: card.stats.deployability,
    });
  });
  return out;
}

// --- Fighters ---------------------------------------------------------------

export async function saveFighterMemory(fighter: Fighter): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const createdMs = new Date(fighter.created_at).getTime() || Date.now();
  const tx = redis.multi();
  tx.set(K.fighter(fighter.id), JSON.stringify(fighter));
  tx.zAdd(K.fightersIndex, [{ score: createdMs, value: fighter.id }]);
  tx.zAdd(K.lbFighters, [{ score: fighter.stats.deployability, value: fighter.id }]);
  await tx.exec();
  return true;
}

export async function getFighterMemory(id: string): Promise<Fighter | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(K.fighter(id));
  return raw ? (JSON.parse(raw) as Fighter) : null;
}

export async function listFightersMemory(): Promise<Fighter[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const ids = await redis.zRange(K.fightersIndex, 0, -1, { REV: true });
  if (!ids.length) return [];
  const raws = await redis.mGet(ids.map(K.fighter));
  return raws
    .filter((r): r is string => Boolean(r))
    .map((r) => JSON.parse(r) as Fighter);
}

// --- Leaderboards (Redis sorted sets) --------------------------------------

export async function leaderboardMoves(limit = 25): Promise<LeaderboardEntry[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const ranked = await redis.zRangeWithScores(K.lbMoves, 0, limit - 1, { REV: true });
  if (!ranked.length) return [];
  const records = await redis.mGet(ranked.map((r) => K.move(r.value)));
  const entries: LeaderboardEntry[] = [];
  ranked.forEach((r, i) => {
    const raw = records[i];
    if (!raw) return;
    const card = (JSON.parse(raw) as MoveRecord).move_card;
    entries.push({
      id: card.id,
      name: card.name,
      score: r.score,
      type: "move",
      verdict: card.verdict,
    });
  });
  return entries;
}

export async function leaderboardFighters(limit = 25): Promise<LeaderboardEntry[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const ranked = await redis.zRangeWithScores(K.lbFighters, 0, limit - 1, { REV: true });
  if (!ranked.length) return [];
  const records = await redis.mGet(ranked.map((r) => K.fighter(r.value)));
  const entries: LeaderboardEntry[] = [];
  ranked.forEach((r, i) => {
    const raw = records[i];
    if (!raw) return;
    const fighter = JSON.parse(raw) as Fighter;
    entries.push({
      id: fighter.id,
      name: fighter.name,
      score: r.score,
      type: "fighter",
    });
  });
  return entries;
}

// --- Historical performance -------------------------------------------------

function parsePerf(h: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(h)) out[k] = Number(v) || 0;
  return out;
}

/** Fold a finished fight into the recent-fights log and perf counters. */
export async function recordFight(
  input: FightRecordInput,
): Promise<FightHistoryEntry | null> {
  const redis = await getRedis();
  if (!redis) return null;

  const [a, b] = input.participants;
  const winnerName =
    input.winner_id === a.id ? a.name : input.winner_id === b.id ? b.name : "Draw";

  const entry: FightHistoryEntry = {
    id: uuidv4().slice(0, 8),
    fighter_a: a.name,
    fighter_b: b.name,
    winner: winnerName,
    final_hp: input.final_hp ?? { a: 0, b: 0 },
    rounds: input.rounds ?? 0,
    source: input.source,
    created_at: new Date().toISOString(),
  };

  const tx = redis.multi();
  tx.lPush(K.fightsRecent, JSON.stringify(entry));
  tx.lTrim(K.fightsRecent, 0, RECENT_FIGHTS_MAX - 1);

  for (const p of input.participants) {
    tx.hIncrBy(K.fighterPerf(p.id), "matches", 1);
    if (input.winner_id === null) tx.hIncrBy(K.fighterPerf(p.id), "draws", 1);
    else if (input.winner_id === p.id) tx.hIncrBy(K.fighterPerf(p.id), "wins", 1);
    else tx.hIncrBy(K.fighterPerf(p.id), "losses", 1);
  }

  for (const ev of input.move_events ?? []) {
    tx.hIncrBy(K.movePerf(ev.move_id), "uses", 1);
    if (ev.hit) tx.hIncrBy(K.movePerf(ev.move_id), "hits", 1);
    else tx.hIncrBy(K.movePerf(ev.move_id), "misses", 1);
    if (ev.knockdown) tx.hIncrBy(K.movePerf(ev.move_id), "knockdowns", 1);
    if (ev.damage) {
      tx.hIncrBy(K.movePerf(ev.move_id), "damage", Math.round(ev.damage));
    }
  }

  await tx.exec();
  return entry;
}

export async function recentFights(limit = 20): Promise<FightHistoryEntry[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const raws = await redis.lRange(K.fightsRecent, 0, limit - 1);
  return raws.map((r) => JSON.parse(r) as FightHistoryEntry);
}

export async function movePerformance(id: string): Promise<MovePerformance | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const h = await redis.hGetAll(K.movePerf(id));
  if (!Object.keys(h).length) return null;
  const p = parsePerf(h);
  return {
    uses: p.uses ?? 0,
    hits: p.hits ?? 0,
    misses: p.misses ?? 0,
    knockdowns: p.knockdowns ?? 0,
    damage: p.damage ?? 0,
  };
}

export async function fighterPerformance(
  id: string,
): Promise<FighterPerformance | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const h = await redis.hGetAll(K.fighterPerf(id));
  if (!Object.keys(h).length) return null;
  const p = parsePerf(h);
  return {
    matches: p.matches ?? 0,
    wins: p.wins ?? 0,
    losses: p.losses ?? 0,
    draws: p.draws ?? 0,
    damage_dealt: p.damage_dealt ?? 0,
  };
}
