"use client";

import { useEffect, useState } from "react";
import type { MoveRecord } from "@/lib/types";
import { StatBar } from "@/components/StatBar";

export default function FighterBuildPage() {
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/moves")
      .then((r) => r.json())
      .then(setMoves);
  }, []);

  const scored = moves.filter((m) => m.move_card.verdict !== "pending");

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length < 1) {
      setError("Pick at least 1 move");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/fighters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, move_ids: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const previewCards = scored.filter((m) => selected.includes(m.move_card.id));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Fighter builder</h1>
      <p className="text-[#8888a0] text-sm mb-6">
        Stack 1–5 move cards into a fighter loadout. Aggregated stats power the arena.
      </p>

      {done ? (
        <div className="p-4 rounded-xl border border-[#3dd68c]/40 bg-[#3dd68c]/10">
          Fighter saved!{" "}
          <a href="/arena" className="text-[#7c5cff] underline">
            Fight in the arena →
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#8888a0] mb-1">
              Fighter name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plaza Phantom"
              required
              className="w-full max-w-md px-3 py-2 rounded-lg bg-[#14141f] border border-[#2a2a3d] outline-none focus:border-[#7c5cff]"
            />
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-[#8888a0] mb-2">
              Moves ({selected.length}/5)
            </p>
            {scored.length === 0 ? (
              <p className="text-sm text-[#8888a0]">
                Ingest a SONIC zip first to get scored moves.
              </p>
            ) : (
              <div className="grid gap-2">
                {scored.map((m) => (
                  <button
                    key={m.move_card.id}
                    type="button"
                    onClick={() => toggle(m.move_card.id)}
                    className={`text-left p-3 rounded-lg border transition ${
                      selected.includes(m.move_card.id)
                        ? "border-[#7c5cff] bg-[#7c5cff]/10"
                        : "border-[#2a2a3d] bg-[#14141f]"
                    }`}
                  >
                    <span className="font-medium">{m.move_card.name}</span>
                    <span className="text-xs text-[#8888a0] ml-2">
                      deploy {Math.round(m.move_card.stats.deployability)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {previewCards.length > 0 && (
            <div className="p-4 rounded-xl border border-[#2a2a3d] bg-[#14141f] max-w-md">
              <p className="text-xs uppercase text-[#8888a0] mb-3">Loadout preview</p>
              {(["speed", "power", "deployability"] as const).map((k) => {
                const avg =
                  previewCards.reduce((s, m) => s + m.move_card.stats[k], 0) /
                  previewCards.length;
                return <StatBar key={k} label={k} value={avg} />;
              })}
            </div>
          )}

          {error && <p className="text-[#ff5c5c] text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || selected.length === 0}
            className="px-6 py-3 rounded-lg bg-[#7c5cff] font-semibold disabled:opacity-50"
          >
            {loading ? "Saving…" : "Create fighter"}
          </button>
        </form>
      )}
    </div>
  );
}
