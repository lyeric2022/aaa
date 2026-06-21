export type Verdict = "safe" | "needs_edits" | "unsafe" | "pending";

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
  video_url?: string;
  plaza_video_url?: string;
  sonic_zip_path?: string;
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

/** A move ranked by feature-vector similarity to another move. */
export interface SimilarMove {
  id: string;
  name: string;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
  attack_type: string;
  verdict: Verdict;
  deployability: number;
}

/** Per-move historical performance, accumulated across recorded fights. */
export interface MovePerformance {
  uses: number;
  hits: number;
  misses: number;
  knockdowns: number;
  damage: number;
}

/** Per-fighter historical performance, accumulated across recorded fights. */
export interface FighterPerformance {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  damage_dealt: number;
}

/** A compact record of a finished fight, kept in a recent-fights log. */
export interface FightHistoryEntry {
  id: string;
  fighter_a: string;
  fighter_b: string;
  winner: string;
  final_hp: { a: number; b: number };
  rounds: number;
  source: "headless_sim" | "live_arena";
  created_at: string;
}

/** What `recordFight` ingests to update the historical-performance tables. */
export interface FightRecordInput {
  /** The two fighters, in order; `id` keys the perf tables, `name` is display. */
  participants: [{ id: string; name: string }, { id: string; name: string }];
  /** Winning participant id, or null for a draw. */
  winner_id: string | null;
  final_hp?: { a: number; b: number };
  rounds?: number;
  source: "headless_sim" | "live_arena";
  /** Optional per-move tallies to fold into move performance. */
  move_events?: {
    move_id: string;
    hit?: boolean;
    knockdown?: boolean;
    damage?: number;
  }[];
}
