"use client";

import { useCallback, useEffect, useState } from "react";
import type { JudgeResult } from "@/lib/judge";

export function LiveJudgePanel({ moveId }: { moveId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`/api/moves/${moveId}/judge`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResult((await res.json()) as JudgeResult);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Judge failed");
      setStatus("error");
    }
  }, [moveId]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="bg-[#14141f] border border-[#2a2a3d] rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#8888a0]">
            Fetch.ai · ASI:One
          </p>
          <h2 className="text-lg font-semibold">Live deployability judge</h2>
        </div>
        <button
          onClick={run}
          disabled={status === "loading"}
          className="rounded-lg border border-[#7c5cff]/40 bg-[#7c5cff]/10 px-4 py-2 text-sm font-medium text-[#c4b5fd] transition hover:border-[#7c5cff] hover:bg-[#7c5cff]/20 disabled:opacity-60"
        >
          {status === "loading" ? "Judging via ASI:One…" : result ? "Re-run live judge" : "Run live judge"}
        </button>
      </div>

      <p className="text-sm leading-relaxed text-[#8888a0]">
        Dynamically sends this card&apos;s latest stats to the Judge uAgent
        (deterministic safety gate + ASI:One). If it is not deployable, the
        Judge consults the Coach uAgent for targeted fixes.
      </p>

      {status === "loading" && !result && (
        <div className="mt-4 rounded-lg border border-[#2a2a3d] bg-[#0f0f18] p-3 text-sm text-[#8888a0]">
          Calling the live Judge/Coach workflow…
        </div>
      )}

      {status === "error" && (
        <div className="mt-4 rounded-lg border border-[#ff5c5c]/30 bg-[#ff5c5c]/10 p-3 text-sm text-[#ff8a8a]">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                result.deployable
                  ? "bg-[#3dd68c]/15 text-[#3dd68c]"
                  : "bg-[#ff5c5c]/15 text-[#ff5c5c]"
              }`}
            >
              {result.deployable ? "Deployable" : "Not deployable"}
            </span>
            <span className="text-sm text-[#8888a0]">
              score <span className="font-semibold text-white">{result.score}</span>
            </span>
            {result.source && (
              <span className="rounded bg-[#7c5cff]/10 px-2 py-1 text-[11px] uppercase tracking-wide text-[#a78bfa]">
                {result.source === "judge_uagent" ? "via Judge uAgent" : "core fallback"}
              </span>
            )}
          </div>

          {result.failing_dims.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.failing_dims.map((d) => (
                <span
                  key={d}
                  className="rounded bg-[#ff5c5c]/10 px-2 py-1 text-[11px] text-[#ff8a8a]"
                >
                  {d}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 text-sm leading-relaxed text-[#b7b7c8]">
            {result.reasoning}
          </p>

          {result.coach_summary && (
            <div className="mt-4 rounded-r-lg border-l-2 border-[#7c5cff] bg-[#7c5cff]/10 p-4 text-sm leading-relaxed">
              <strong className="text-[#a78bfa]">Coach:</strong>{" "}
              {result.coach_summary}
              {result.fixes && (
                <ul className="mt-2 list-disc pl-5 text-[#c8c8d4]">
                  {Object.entries(result.fixes).map(([dim, fix]) => (
                    <li key={dim} className="mt-1">
                      <span className="font-semibold text-white">{dim}:</span>{" "}
                      {fix}
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
