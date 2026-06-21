import { getLeaderboards } from "@/lib/leaderboard";
import { VerdictBadge } from "@/components/StatBar";

export default async function LeaderboardPage() {
  const { moves: moveEntries, fighters: fighterEntries } = await getLeaderboards();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leaderboard</h1>

      <section className="mb-10">
        <h2 className="text-sm uppercase tracking-wider text-[#8888a0] mb-3">
          Top moves
        </h2>
        <div className="space-y-2">
          {moveEntries.length ? (
            moveEntries.map((e, i) => (
                <a
                  key={e.id}
                  href={`/moves/${e.id}`}
                  className="flex items-center gap-4 p-3 rounded-lg border border-[#2a2a3d] bg-[#14141f] hover:border-[#7c5cff]/40"
                >
                  <span className="text-[#7c5cff] font-mono w-6">#{i + 1}</span>
                  <span className="flex-1 font-medium">{e.name}</span>
                  <span className="text-sm text-[#8888a0]">
                    {Math.round(e.score)}
                  </span>
                  {e.verdict && <VerdictBadge verdict={e.verdict} />}
                </a>
            ))
          ) : (
            <p className="text-[#8888a0] text-sm">No scored moves yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-[#8888a0] mb-3">
          Top fighters
        </h2>
        <div className="space-y-2">
          {fighterEntries.length ? (
            fighterEntries.map((e, i) => (
                <div
                  key={e.id}
                  className="flex items-center gap-4 p-3 rounded-lg border border-[#2a2a3d] bg-[#14141f]"
                >
                  <span className="text-[#ff5c5c] font-mono w-6">#{i + 1}</span>
                  <span className="flex-1 font-medium">{e.name}</span>
                  <span className="text-sm text-[#8888a0]">
                    {Math.round(e.score)}
                  </span>
                </div>
            ))
          ) : (
            <p className="text-[#8888a0] text-sm">
              Build fighters to rank them here.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
