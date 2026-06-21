import type { MoveCard, MoveStats, Verdict } from "./types";

export interface JudgeResult {
  move_name: string;
  normalized_stats: Record<string, number>;
  deployable: boolean;
  score: number;
  failing_dims: string[];
  reasoning: string;
  coach_summary?: string;
  fixes?: Record<string, string>;
  source?: "judge_uagent" | "core_fallback";
}

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8010";
const DEFAULT_TIMEOUT_MS = 45_000;

export function judgeBridgeUrl(): string {
  return process.env.JUDGE_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL;
}

/** Stats the Judge bridge scores (0–100 or 0–1; bridge normalizes). */
export function statsForJudge(stats: MoveStats): Record<string, number> {
  return {
    balance_risk: stats.balance_risk,
    smoothness: stats.smoothness,
    recovery: stats.recovery,
    speed: stats.speed,
  };
}

export function verdictFromJudge(deployable: boolean, score: number): Verdict {
  if (deployable) return "safe";
  if (score >= 0.45) return "needs_edits";
  return "unsafe";
}

export function formatCoachFeedback(result: JudgeResult): string {
  const parts: string[] = [result.reasoning.trim()];
  if (result.coach_summary?.trim()) {
    parts.push(result.coach_summary.trim());
  }
  if (result.fixes) {
    for (const [dim, fix] of Object.entries(result.fixes)) {
      parts.push(`${dim}: ${fix.trim()}`);
    }
  }
  return parts.join("\n\n");
}

export function applyJudgeToMoveCard(
  card: MoveCard,
  result: JudgeResult,
): MoveCard {
  const judgedAt = new Date().toISOString();
  return {
    ...card,
    verdict: verdictFromJudge(result.deployable, result.score),
    stats: {
      ...card.stats,
      deployability: Math.round(result.score * 1000) / 10,
    },
    coach_feedback: formatCoachFeedback(result),
    judge: {
      deployable: result.deployable,
      score: result.score,
      failing_dims: result.failing_dims,
      reasoning: result.reasoning,
      coach_summary: result.coach_summary,
      fixes: result.fixes,
      source: result.source,
      judged_at: judgedAt,
    },
    pipeline: {
      ...card.pipeline,
      eval: "ASI:One judge + coach (Fetch.ai)",
    },
  };
}

/** POST move stats to the Python web_bridge. Returns null if the bridge is down. */
export async function judgeMove(
  name: string,
  stats: Record<string, number>,
  opts?: { timeoutMs?: number; moveId?: string },
): Promise<JudgeResult | null> {
  const url = `${judgeBridgeUrl()}/judge`;
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        move_id: opts?.moveId,
        stats,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as JudgeResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
