"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JudgeVerdict, Verdict } from "@/lib/types";
import { VerdictBadge } from "@/components/StatBar";

function verdictFromJudge(deployable: boolean, score: number): Verdict {
  if (deployable) return "safe";
  if (score >= 0.45) return "needs_edits";
  return "unsafe";
}

export function LiveJudgePanel({
  moveId,
  moveName,
  stats,
  initialJudge,
}: {
  moveId: string;
  moveName: string;
  stats: {
    speed: number;
    smoothness: number;
    balance_risk: number;
    recovery: number;
  };
  initialJudge?: JudgeVerdict | null;
}) {
  const [judge, setJudge] = useState<JudgeVerdict | null>(initialJudge ?? null);
  const [loading, setLoading] = useState(!initialJudge);
  const [error, setError] = useState("");
  const judgeInflight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setJudge(initialJudge ?? null);
    setLoading(!initialJudge);
    setError("");
    judgeInflight.current = null;
  }, [moveId, initialJudge]);

  const runJudge = useCallback(async () => {
    if (judgeInflight.current) {
      await judgeInflight.current;
      return;
    }

    const task = (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/moves/${moveId}/judge`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Judge request failed");
        }
        setJudge(data.judge as JudgeVerdict);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Judge request failed");
      } finally {
        setLoading(false);
      }
    })();

    judgeInflight.current = task;
    try {
      await task;
    } finally {
      if (judgeInflight.current === task) {
        judgeInflight.current = null;
      }
    }
  }, [moveId]);

  useEffect(() => {
    void runJudge();
  }, [runJudge]);

  return (
    <div className="bg-[#14141f] border border-[#2a2a3d] rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#a78bfa]">
            Fetch.ai Live Judge
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7c5cff]/15 text-[#c4b5fd] border border-[#7c5cff]/30">
            ASI:One + Coach
          </span>
        </div>
        <button
          type="button"
          onClick={() => void runJudge()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2a3d] text-[#8888a0] hover:text-white hover:border-[#7c5cff]/50 disabled:opacity-50 transition"
        >
          {loading ? "Judging…" : "Re-judge"}
        </button>
      </div>

      <p className="text-xs text-[#8888a0] mb-4 leading-relaxed">
        Judging <strong className="text-[#c4b5fd]">{moveName}</strong> from
        motion stats (balance risk, smoothness, recovery, speed). Identical stats
        produce the same verdict — re-ingest each SONIC zip to score unique
        motion.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
        {(
          [
            ["balance_risk", stats.balance_risk, true],
            ["smoothness", stats.smoothness, false],
            ["recovery", stats.recovery, false],
            ["speed", stats.speed, false],
          ] as const
        ).map(([label, value, risk]) => (
          <div
            key={label}
            className="rounded-lg border border-[#2a2a3d] bg-[#0e0e16] px-2 py-1.5"
          >
            <span className="text-[#666680] uppercase tracking-wide">{label}</span>
            <div className={risk ? "text-[#ff8a8a]" : "text-white"}>
              {value.toFixed(1)}
            </div>
          </div>
        ))}
      </div>

      {loading && !judge && (
        <p className="text-sm text-[#8888a0] animate-pulse">
          Sending move stats to the Fetch.ai Judge bridge…
        </p>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-[#ff5c5c]/10 border border-[#ff5c5c]/30 text-sm text-[#ffb4b4]">
          {error}
        </div>
      )}

      {judge && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge verdict={verdictFromJudge(judge.deployable, judge.score)} />
            <span className="text-sm text-[#8888a0]">
              deployability score{" "}
              <strong className="text-white">
                {(judge.score * 100).toFixed(1)}
              </strong>
              / 100
            </span>
            <span className="text-xs text-[#666680]">
              judged {new Date(judge.judged_at).toLocaleString()}
            </span>
          </div>

          <div className="p-4 bg-[#0e0e16] border border-[#2a2a3d] rounded-lg">
            <p className="text-xs uppercase tracking-wider text-[#8888a0] mb-2">
              Judge
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {judge.reasoning}
            </p>
            {judge.failing_dims.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {judge.failing_dims.map((dim) => (
                  <span
                    key={dim}
                    className="text-[10px] px-2 py-1 rounded bg-[#ff5c5c]/12 text-[#ff8a8a] uppercase tracking-wide"
                  >
                    {dim}
                  </span>
                ))}
              </div>
            )}
          </div>

          {(judge.coach_summary || judge.fixes) && (
            <div className="p-4 bg-[#7c5cff]/10 border-l-2 border-[#7c5cff] rounded-r-lg">
              <p className="text-xs uppercase tracking-wider text-[#a78bfa] mb-2">
                Coach
              </p>
              {judge.coach_summary && (
                <p className="text-sm leading-relaxed mb-3 whitespace-pre-line">
                  {judge.coach_summary}
                </p>
              )}
              {judge.fixes && (
                <ul className="space-y-2 text-sm leading-relaxed">
                  {Object.entries(judge.fixes).map(([dim, fix]) => (
                    <li key={dim}>
                      <strong className="text-[#c4b5fd]">{dim}:</strong> {fix}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
