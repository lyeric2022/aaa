// Enemy (AI opponent) types.
//
// These are BEHAVIOR/CONFIG types. We deliberately import the domain models
// (MoveCard, FighterPhysicsState, FightResult) from the existing arena rather
// than redefining them — the enemy consumes the SAME move stats the scorer
// computes. See docs/enemy_integration_plan.md.

import type { FightResult, MoveCard } from "../types";
import type { Rng } from "./rng";

/** What the player/enemy sees each frame — the same state the player sees. */
export interface ArenaObservation {
  /** Arena tick index (1-based), used to schedule the internal rates. */
  tick: number;
  /** Effective frames-per-second the loop runs at (adapter input). */
  rateHz: number;
  /** This fighter's live physics state. */
  self: FighterPhysicsLike;
  /** Opponent's live physics state. */
  opponent: FighterPhysicsLike;
  /** This fighter's own deck — the exact scored MoveCards. */
  deck: MoveCard[];
  /** Distance between fighters in metres (|self.x - opponent.x|). */
  range: number;
}

/** Structural subset of FighterPhysicsState the brain reads (keeps it decoupled). */
export interface FighterPhysicsLike {
  hp: number;
  x: number;
  balance: number;
  stamina: number;
  cooldown: number;
  stance: "stable" | "extended" | "recovering" | "knockdown";
}

/** The three things the existing arena loop can actually do in a tick. */
export type ArenaAction =
  | { kind: "move"; moveId: string }
  | { kind: "advance" }
  | { kind: "wait" };

/**
 * The per-frame contract. The headless arena's move decision and Arena3D's
 * human `playMove` are both expressed through this. A controller is asked to
 * `decide` once per tick; optional hooks feed online learning and the future
 * (out-of-loop) LLM layer.
 */
export interface FighterController {
  /** Per-frame decision. Pure + synchronous. NO LLM, NO IO. */
  decide(obs: ArenaObservation, rng: Rng): ArenaAction;
  /** Observation that the OTHER fighter just committed a move. */
  observeOpponentMove?(moveId: string, outcome: MoveOutcome): void;
  /** Out-of-loop hook for the future meta-coach / persona-author / narrator. */
  onRoundEnd?(summary: RoundEndSummary): void;
  /** Human-readable label for transcripts / UI. */
  readonly label?: string;
}

export interface MoveOutcome {
  hit: boolean;
  damage: number;
  knockdown: boolean;
  range: number;
}

export interface RoundEndSummary {
  result: FightResult;
  selfName: string;
  opponentName: string;
}

/** STYLE — orthogonal to difficulty. What game-plan the enemy pursues. */
export type Intent = "pressure" | "zone" | "counter" | "reset";

/** SKILL knobs — orthogonal to style. How well/cleanly the enemy executes. */
export interface DifficultyConfig {
  /** Frames of perception lag (0 = frame-perfect). */
  reaction_delay: number;
  /** Probability the tactician keeps its top-ranked move (vs a lesser one). */
  optimal_prob: number;
  /** Probability of an outright blunder (commit out of range / waste a turn). */
  mistake_rate: number;
  /** 0..1 weight on online player-modeling (anti-spam adaptation). */
  adaptation: number;
  /** Magnitude of seeded utility noise (exploration / unpredictability). */
  noise: number;
}

/** Per-intent bias added to a move's utility (style expressed as preferences). */
export interface BiasWeights {
  /** Reward closing distance / staying in range. */
  aggression: number;
  /** Reward keeping the opponent at the edge of reach. */
  spacing: number;
  /** Reward waiting to whiff-punish (acting after opponent commits). */
  patience: number;
  /** Reward resetting / recovering balance and stamina. */
  caution: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  baseIntent: Intent;
  difficulty: DifficultyConfig;
  bias: BiasWeights;
}

/** Online model of the opponent the strategist builds during a match. */
export interface PlayerModel {
  /** moveId -> times seen. */
  freq: Record<string, number>;
  /** Total moves observed. */
  total: number;
  /** moveId of the most recently observed opponent move. */
  last?: string;
  /** Consecutive repeats of `last` (drives anti-spam counter-bias). */
  repeatStreak: number;
}

/** Per-persona matchup result inside the readiness profile. */
export interface MatchupResult {
  personaId: string;
  personaName: string;
  matches: number;
  wins: number;
  winRate: number;
  /** Dominant reason the deck lost, derived from the real fight transcript. */
  whyItLoses: string;
}

/** Output of the adversarial evaluation harness. */
export interface CompetitionReadiness {
  fighter: string;
  /** Existing static scorer signal, surfaced (not overwritten). */
  deployability: number;
  /** Mean win-rate across the full persona pool (0..1). */
  overallWinRate: number;
  /** 0..100 readiness blending win-rate with deployability. */
  readinessScore: number;
  matchups: MatchupResult[];
  summary: string;
}
