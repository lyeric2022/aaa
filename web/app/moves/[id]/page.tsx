import { notFound } from "next/navigation";
import { getMove } from "@/lib/storage";
import { MoveCardView } from "@/components/MoveCardView";
import { PlazaUpload } from "@/components/PlazaUpload";
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
        3D robot body before sending it to MuJoCo or the plaza G1.
      </div>
      <div className="grid gap-6">
        <MoveCardView card={record.move_card} motionStats={record.stats} />
        <RobotReplay3D moveId={id} />
        <VerificationPanel card={record.move_card} />
      </div>
      <PlazaUpload moveId={id} hasPlaza={!!record.move_card.plaza_video_url} />
    </div>
  );
}
