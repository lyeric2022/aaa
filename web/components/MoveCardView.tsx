import type { MoveCard, MotionStats } from "@/lib/types";
import { StatBar, VerdictBadge } from "@/components/StatBar";

export function MoveCardView({
  card,
  motionStats,
}: {
  card: MoveCard;
  motionStats?: MotionStats | null;
}) {
  return (
    <div className="bg-[#14141f] border border-[#2a2a3d] rounded-2xl p-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <VerdictBadge verdict={card.verdict} />
        {card.studio_sonic_validated && (
          <span className="text-xs px-2 py-1 rounded bg-[#7c5cff]/20 text-[#7c5cff]">
            Studio SONIC ✓
          </span>
        )}
      </div>

      <StatBar label="Speed" value={card.stats.speed} />
      <StatBar label="Power" value={card.stats.power} />
      <StatBar label="Smoothness" value={card.stats.smoothness} />
      <StatBar label="Balance Risk" value={card.stats.balance_risk} risk />
      <StatBar label="Recovery" value={card.stats.recovery} />
      <StatBar label="Deployability" value={card.stats.deployability} />

      <div className="mt-4 p-4 bg-[#7c5cff]/10 border-l-2 border-[#7c5cff] rounded-r-lg text-sm leading-relaxed">
        <strong className="text-[#a78bfa]">Coach:</strong> {card.coach_feedback}
      </div>

      {motionStats && (
        <p className="mt-3 text-xs text-[#8888a0]">
          {motionStats.duration_sec}s · {motionStats.frame_count} frames ·{" "}
          {motionStats.joint_count} joints
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(["data", "eval", "deploy"] as const).map((k) => (
          <span
            key={k}
            className="text-[10px] uppercase tracking-wider px-2 py-1 border border-[#2a2a3d] rounded text-[#8888a0]"
          >
            {k}: {card.pipeline[k]}
          </span>
        ))}
      </div>

      {card.video_url && (
        <video
          src={card.video_url}
          controls
          className="mt-4 w-full rounded-lg border border-[#2a2a3d]"
        />
      )}

      {card.plaza_video_url ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-[#3dd68c] mb-2">
            Plaza proof — G1 deploy
          </p>
          <video
            src={card.plaza_video_url}
            controls
            className="w-full rounded-lg border border-[#3dd68c]/30"
          />
        </div>
      ) : (
        <div className="mt-4 p-4 border border-dashed border-[#2a2a3d] rounded-lg text-sm text-[#8888a0]">
          Plaza proof pending — upload G1 video after Lower Sproul deploy
        </div>
      )}
    </div>
  );
}
