export type Verdict = "safe" | "needs_edits" | "unsafe" | "pending";

/** Structured verdict from the Fetch.ai Judge + Coach bridge. */
export interface JudgeVerdict {
  deployable: boolean;
  score: number;
  failing_dims: string[];
  reasoning: string;
  coach_summary?: string;
  fixes?: Record<string, string>;
  judged_at: string;
}

export interface MoveStats {
  speed: number;
  power: number;
  smoothness: number;
  balance_risk: number;
  recovery: number;
  deployability: number;
}

export interface MotionStats {
  duration_sec: number;
  fps: number;
  frame_count: number;
  joint_count: number;
  peak_velocity: number;
  mean_velocity: number;
  smoothness: number;
  jerk_score: number;
  extension_risk: number;
  recovery_score: number;
  deploy_score: number;
  verdict: Verdict;
}

export interface MoveCard {
  id: string;
  name: string;
  source: "ultimate_bots_studio" | "video_upload" | "sonic_zip";
  attack_type: string;
  studio_sonic_validated: boolean;
  stats: MoveStats;
  verdict: Verdict;
  coach_feedback: string;
  /** Live Fetch.ai judge + coach payload (also mirrored into coach_feedback). */
  judge?: JudgeVerdict;
  video_url?: string;
  plaza_video_url?: string;
  sonic_zip_path?: string;
  /** Extracted SONIC CSV folder (joint_pos.csv) for 3D replay. */
  motion_dir?: string;
  verification?: VerificationResult;
  created_at: string;
  pipeline: {
    data: string;
    eval: string;
    deploy: string;
  };
}

export interface MoveRecord {
  stats: MotionStats | null;
  move_card: MoveCard;
}

export interface Fighter {
  id: string;
  name: string;
  move_ids: string[];
  stats: MoveStats;
  created_at: string;
}

export type VerificationStatus = "pending" | "passed" | "failed" | "not_run";

export interface VerificationResult {
  status: VerificationStatus;
  backend: "gear_sonic_mujoco" | "manual_upload";
  video_url?: string;
  notes?: string;
  metrics?: {
    torso_tilt_deg?: number;
    com_drift_m?: number;
    foot_slip_m?: number;
    fall_detected?: boolean;
  };
  updated_at: string;
}

export interface FighterPhysicsState {
  name: string;
  hp: number;
  x: number;
  balance: number;
  stamina: number;
  cooldown: number;
  stance: "stable" | "extended" | "recovering" | "knockdown";
}

export interface FightRound {
  round: number;
  attacker: string;
  defender: string;
  move_used: string;
  damage: number;
  narration: string;
  hp_after: { a: number; b: number };
  event_type?: "advance" | "hit" | "miss" | "knockdown" | "recover" | "ko";
  range_m?: number;
  knockback_m?: number;
  balance_loss?: number;
  states?: { a: FighterPhysicsState; b: FighterPhysicsState };
}

export interface FightResult {
  fighter_a: string;
  fighter_b: string;
  winner: string;
  rounds: FightRound[];
  final_hp: { a: number; b: number };
  final_state?: { a: FighterPhysicsState; b: FighterPhysicsState };
  sim_type?: "physics_aware_2d";
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  type: "move" | "fighter";
  verdict?: Verdict;
}
