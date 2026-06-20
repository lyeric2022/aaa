import type { MotionStats, MoveCard, MoveStats, Verdict } from "./types";

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, value));
}

function diffSeries(values: number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]);
}

export function parseFps(infoText: string): number {
  for (const line of infoText.split("\n")) {
    if (line.startsWith("target_fps:")) {
      return parseFloat(line.split(":")[1].trim());
    }
  }
  return 50;
}

export function parseJointCsv(csv: string): number[][] {
  const lines = csv.trim().split("\n");
  const header = lines[0];
  if (!header?.startsWith("joint")) {
    throw new Error("Unexpected CSV header");
  }
  return lines.slice(1).map((line) => line.split(",").map(Number));
}

export function analyzeJointPositions(
  positions: number[][],
  fps: number,
): MotionStats {
  const frameCount = positions.length;
  const jointCount = positions[0]?.length ?? 0;
  const durationSec = frameCount / fps;

  const perFrameVel: number[] = [];
  const perFrameAcc: number[] = [];
  const perFrameJerk: number[] = [];

  for (let jointIdx = 0; jointIdx < jointCount; jointIdx++) {
    const series = positions.map((frame) => frame[jointIdx]);
    const vel = diffSeries(series);
    const acc = diffSeries(vel);
    const jerk = diffSeries(acc);

    for (const v of vel) perFrameVel.push(Math.abs(v) * fps);
    for (const a of acc) perFrameAcc.push(Math.abs(a) * fps * fps);
    for (const j of jerk) perFrameJerk.push(Math.abs(j) * fps ** 3);
  }

  const peakVelocity = perFrameVel.length ? Math.max(...perFrameVel) : 0;
  const meanVelocity =
    perFrameVel.reduce((a, b) => a + b, 0) / (perFrameVel.length || 1);
  const accMean =
    perFrameAcc.reduce((a, b) => a + b, 0) / (perFrameAcc.length || 1);
  const jerkSorted = [...perFrameJerk].sort((a, b) => a - b);
  const jerkP95 = jerkSorted[Math.floor(jerkSorted.length * 0.95)] ?? 0;

  const smoothness = clamp(100 - accMean * 0.35);
  const jerkScore = clamp(jerkP95 * 0.08);
  const maxAbsAngle = Math.max(
    ...positions.flatMap((frame) => frame.map(Math.abs)),
  );
  const extensionRisk = clamp(maxAbsAngle * 38);

  const tailLen = Math.max(10, Math.floor(frameCount / 10));
  const tail = positions.slice(-tailLen);
  const tailMeans = Array.from({ length: jointCount }, (_, j) =>
    tail.reduce((sum, frame) => sum + frame[j], 0) / tail.length,
  );
  let tailVariance = 0;
  for (const frame of tail) {
    for (let j = 0; j < jointCount; j++) {
      tailVariance += (frame[j] - tailMeans[j]) ** 2;
    }
  }
  tailVariance /= tail.length * Math.max(jointCount, 1);
  const recoveryScore = clamp(100 - tailVariance * 800);

  const speedStat = clamp(peakVelocity * 2.2);
  const balanceRisk = clamp(
    extensionRisk * 0.4 + jerkScore * 0.35 + (100 - recoveryScore) * 0.25,
  );

  const deployScore = clamp(
    smoothness * 0.3 +
      recoveryScore * 0.25 +
      (100 - balanceRisk) * 0.25 +
      speedStat * 0.2,
  );

  let verdict: Verdict = "unsafe";
  if (deployScore >= 68 && balanceRisk <= 50) verdict = "safe";
  else if (deployScore >= 45 && balanceRisk <= 70) verdict = "needs_edits";

  return {
    duration_sec: Math.round(durationSec * 1000) / 1000,
    fps,
    frame_count: frameCount,
    joint_count: jointCount,
    peak_velocity: Math.round(peakVelocity * 10000) / 10000,
    mean_velocity: Math.round(meanVelocity * 10000) / 10000,
    smoothness: Math.round(smoothness * 10) / 10,
    jerk_score: Math.round(jerkScore * 10) / 10,
    extension_risk: Math.round(extensionRisk * 10) / 10,
    recovery_score: Math.round(recoveryScore * 10) / 10,
    deploy_score: Math.round(deployScore * 10) / 10,
    verdict,
  };
}

function coachForVerdict(verdict: Verdict): string {
  switch (verdict) {
    case "safe":
      return "Motion looks deployable. Consider adding a sharper wind-up for crowd appeal.";
    case "needs_edits":
      return "Reduce peak spin speed or widen stance before the fastest segment.";
    default:
      return "High balance risk detected. Slow the rotation and shorten arm extension.";
  }
}

export function buildMoveCard(
  id: string,
  name: string,
  motionStats: MotionStats,
  opts: {
    source: MoveCard["source"];
    sonicValidated?: boolean;
    videoUrl?: string;
    sonicZipPath?: string;
    plazaVideoUrl?: string;
  },
): MoveCard {
  const balanceRisk = clamp(
    motionStats.extension_risk * 0.4 +
      motionStats.jerk_score * 0.35 +
      (100 - motionStats.recovery_score) * 0.25,
  );

  return {
    id,
    name,
    source: opts.source,
    attack_type: "strike_combo",
    studio_sonic_validated: opts.sonicValidated ?? false,
    stats: {
      speed: clamp(motionStats.peak_velocity * 2.2),
      power: clamp(motionStats.mean_velocity * 35),
      smoothness: motionStats.smoothness,
      balance_risk: balanceRisk,
      recovery: motionStats.recovery_score,
      deployability: motionStats.deploy_score,
    },
    verdict: motionStats.verdict,
    coach_feedback: coachForVerdict(motionStats.verdict),
    video_url: opts.videoUrl,
    plaza_video_url: opts.plazaVideoUrl,
    sonic_zip_path: opts.sonicZipPath,
    created_at: new Date().toISOString(),
    pipeline: {
      data:
        opts.source === "video_upload"
          ? "webcam / video upload"
          : "human recording + studio retarget",
      eval: "joint trajectory heuristics",
      deploy: opts.sonicValidated
        ? "sonic zip validated in studio simulate"
        : "awaiting sonic export",
    },
  };
}

export function aggregateStats(cards: MoveCard[]): MoveStats {
  if (!cards.length) {
    return {
      speed: 0,
      power: 0,
      smoothness: 0,
      balance_risk: 0,
      recovery: 0,
      deployability: 0,
    };
  }
  const keys = [
    "speed",
    "power",
    "smoothness",
    "balance_risk",
    "recovery",
    "deployability",
  ] as const;
  const result = {} as MoveStats;
  for (const key of keys) {
    result[key] =
      Math.round(
        (cards.reduce((sum, c) => sum + c.stats[key], 0) / cards.length) * 10,
      ) / 10;
  }
  return result;
}
