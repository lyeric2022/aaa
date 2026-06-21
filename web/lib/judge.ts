import type { MoveStats } from "@/lib/types";

export interface JudgeResult {
  move_name: string;
  normalized_stats: Record<string, number>;
  deployable: boolean;
  score: number;
  failing_dims: string[];
  reasoning: string;
  coach_summary?: string;
  fixes?: Record<string, string>;
}

// The Python bridge (agents/web_bridge.py) wraps the same Judge -> Coach logic
// the agents run on ASI:One. Override with JUDGE_BRIDGE_URL if you run it on a
// different host/port.
const BRIDGE_URL = process.env.JUDGE_BRIDGE_URL ?? "http://localhost:8010";

/**
 * Send a move card's stats to the Judge bridge and return the verdict +
 * coaching. The bridge accepts 0-100 values (it normalizes to 0-1), so we pass
 * the web MoveStats through directly. `power` / `deployability` are ignored by
 * the Judge.
 */
export async function judgeMove(name: string, stats: MoveStats): Promise<JudgeResult> {
  const res = await fetch(`${BRIDGE_URL}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      stats: {
        balance_risk: stats.balance_risk,
        smoothness: stats.smoothness,
        recovery: stats.recovery,
        speed: stats.speed,
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Judge bridge returned ${res.status}`);
  }
  return (await res.json()) as JudgeResult;
}
