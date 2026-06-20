import Link from "next/link";
import { seedDemoMove, listMoves } from "@/lib/storage";
import { VerdictBadge } from "@/components/StatBar";

export default async function HomePage() {
  await seedDemoMove();
  const moves = await listMoves();

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-[#8888a0] mb-2">
        Physical AI · Robot Sports
      </p>
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Ghost Fighter</h1>
      <p className="text-[#8888a0] mb-8 max-w-2xl leading-relaxed">
        Turn human movement into scored, deployable robot skills. Ingest motion,
        get a move card, build a fighter, clash in the arena, deploy to G1.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        {[
          { href: "/ingest", label: "Ingest", desc: "Video or SONIC zip" },
          { href: "/fighters/build", label: "Fighters", desc: "Stack 3–5 moves" },
          { href: "/arena", label: "Arena", desc: "1v1 auto-resolve" },
          { href: "/leaderboard", label: "Leaderboard", desc: "Top moves & fighters" },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block p-4 rounded-xl border border-[#2a2a3d] bg-[#14141f] hover:border-[#7c5cff]/50 transition"
          >
            <div className="font-semibold text-[#7c5cff]">{c.label}</div>
            <div className="text-sm text-[#8888a0]">{c.desc}</div>
          </Link>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-4">Move library</h2>
      {moves.length === 0 ? (
        <p className="text-[#8888a0]">
          No moves yet.{" "}
          <Link href="/ingest" className="text-[#7c5cff] underline">
            Ingest your first motion
          </Link>
        </p>
      ) : (
        <div className="grid gap-3">
          {moves.map((m) => (
            <Link
              key={m.move_card.id}
              href={`/moves/${m.move_card.id}`}
              className="flex items-center justify-between p-4 rounded-xl border border-[#2a2a3d] bg-[#14141f] hover:border-[#7c5cff]/40 transition"
            >
              <div>
                <div className="font-medium">{m.move_card.name}</div>
                <div className="text-xs text-[#8888a0]">
                  Deploy {Math.round(m.move_card.stats.deployability)}/100
                </div>
              </div>
              <VerdictBadge verdict={m.move_card.verdict} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
