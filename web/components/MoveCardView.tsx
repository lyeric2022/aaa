import type { MoveCard, MotionStats } from "@/lib/types";
import { StatBar, VerdictBadge } from "@/components/StatBar";

const STAT_INFO = {
  speed:
    "How fast the move peaks. Based on maximum joint angular velocity across all 29 joints. Higher = snappier execution.",
  power:
    "Sustained intensity through the move. Based on average joint velocity. Higher = more forceful, committed motion.",
  smoothness:
    "How clean the motion feels. Penalizes sharp acceleration spikes and jitter. Higher = smoother, less robotic stutter.",
  balance_risk:
    "Likelihood the G1 loses balance or over-extends. Combines joint extension, jerk, and end-of-motion instability. Lower is safer.",
  recovery:
    "How well the robot settles after the move. Measures stability in the final 10% of frames. Higher = cleaner return to neutral.",
  deployability:
    "Overall robot-readiness score. Weighted mix of smoothness, recovery, balance risk, and speed. Higher = more likely to run on hardware.",
} as const;

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
        <span className="text-xs px-2 py-1 rounded bg-[#8888a0]/10 text-[#8888a0]">
          Heuristic baseline
        </span>
        {card.studio_sonic_validated && (
          <span className="text-xs px-2 py-1 rounded bg-[#7c5cff]/20 text-[#7c5cff]">
            Studio SONIC ✓
          </span>
        )}
      </div>

      <StatBar label="Speed" value={card.stats.speed} info={STAT_INFO.speed} />
      <StatBar label="Power" value={card.stats.power} info={STAT_INFO.power} />
      <StatBar
        label="Smoothness"
        value={card.stats.smoothness}
        info={STAT_INFO.smoothness}
      />
      <StatBar
        label="Balance Risk"
        value={card.stats.balance_risk}
        risk
        info={STAT_INFO.balance_risk}
      />
      <StatBar
        label="Recovery"
        value={card.stats.recovery}
        info={STAT_INFO.recovery}
      />
      <StatBar
        label="Deployability"
        value={card.stats.deployability}
        info={STAT_INFO.deployability}
      />

      <div className="mt-4 p-4 bg-[#8888a0]/10 border-l-2 border-[#8888a0] rounded-r-lg text-sm leading-relaxed text-[#b7b7c8]">
        <strong className="text-[#c8c8d4]">Static baseline note:</strong>{" "}
        {card.coach_feedback}
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

    </div>
  );
}
