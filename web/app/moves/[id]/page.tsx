import Link from "next/link";
import { notFound } from "next/navigation";
import { getMove } from "@/lib/storage";
import { similarMoves } from "@/lib/moveMemory";
import { MoveCardView } from "@/components/MoveCardView";
import { RobotReplay3D } from "@/components/RobotReplay3D";
import { VerificationPanel } from "@/components/VerificationPanel";
import { MoveAnnouncerButton } from "@/components/MoveAnnouncerButton";

export default async function MovePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) notFound();

  // Redis-backed feature-vector similarity; empty when Redis isn't configured.
  const similar = await similarMoves(id, 4);

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[#8888a0] mb-1">
        Move card
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{record.move_card.name}</h1>
        <MoveAnnouncerButton
          name={record.move_card.name}
          speed={record.move_card.stats.speed}
          power={record.move_card.stats.power}
          balanceRisk={record.move_card.stats.balance_risk}
        />
      </div>
      <div className="mb-6 rounded-2xl border border-[#2a2a3d] bg-[#14141f] p-5 text-sm leading-relaxed text-[#b7b7c8]">
        <strong className="text-white">This is one robot skill.</strong> We
        ingested your Studio/SONIC motion, scored it for humanoid readiness,
        turned it into a reusable move card, and can preview the trajectory on a
        3D robot body.
      </div>
      <div className="grid gap-6">
        <MoveCardView card={record.move_card} motionStats={record.stats} />
        <RobotReplay3D moveId={id} />
        <VerificationPanel card={record.move_card} />
        {similar.length > 0 && (
          <section className="rounded-2xl border border-[#2a2a3d] bg-[#14141f] p-5">
            <p className="mb-1 text-xs uppercase tracking-wider text-[#7c5cff]">
              Move memory · similarity search
            </p>
            <h2 className="mb-4 text-lg font-semibold">Similar moves</h2>
            <div className="grid gap-2">
              {similar.map((m) => (
                <Link
                  key={m.id}
                  href={`/moves/${m.id}`}
                  className="flex items-center gap-4 rounded-lg border border-[#2a2a3d] bg-black/25 p-3 hover:border-[#7c5cff]/40"
                >
                  <span className="flex-1 font-medium">{m.name}</span>
                  <span className="text-xs text-[#8888a0]">{m.attack_type}</span>
                  <span className="font-mono text-sm text-[#3dd68c]">
                    {Math.round(m.similarity * 100)}% match
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
