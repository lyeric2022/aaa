// Tactician (~15 Hz): Utility-AI move selection.
//
// Scores each MoveCard NOW from the EXISTING stats (via the arena's own
// movePhysics derivation) under the current intent, then picks the highest
// utility with seeded noise. Pure + synchronous — NO LLM, NO IO.

import type { MoveCard } from "../types";
import { movePhysics } from "../arena-physics";
import type { Rng } from "./rng";
import type {
  ArenaObservation,
  BiasWeights,
  DifficultyConfig,
  Intent,
} from "./types";

export interface ScoredMove {
  move: MoveCard;
  utility: number;
  inRange: boolean;
}

/** Normalize a 0..100-ish stat to ~0..1. */
function n(v: number): number {
  return Math.max(0, Math.min(1, v / 100));
}

/**
 * Derived "expected reward" for a move. There is no expected_reward field on
 * MoveStats, so we derive it from existing stats + the arena's impact model:
 * a clean, deployable, high-impact move is worth more.
 */
function expectedReward(move: MoveCard): number {
  const phys = movePhysics(move);
  const impact = phys.impact / 100; // impact ~ power/speed blend
  return 0.5 * impact + 0.3 * n(move.stats.power) + 0.2 * n(move.stats.deployability);
}

/** How well the move's reach fits the current gap (1 = ideal, 0 = bad). */
function rangeFit(move: MoveCard, range: number): { fit: number; inRange: boolean } {
  const reach = movePhysics(move).range;
  const inRange = range <= reach;
  if (!inRange) {
    // Out of reach: the further short we are, the worse.
    const deficit = (range - reach) / Math.max(reach, 0.1);
    return { fit: Math.max(0, 1 - deficit), inRange: false };
  }
  // In reach: best when the opponent sits near the tip of our range (clean
  // hit, less commitment). Being far inside reach is fine but slightly worse.
  const closeness = range / reach; // 0 (point blank) .. 1 (tip)
  return { fit: 0.6 + 0.4 * closeness, inRange: true };
}

/**
 * Timing term: whiff-punish & interrupt. If the opponent is committed/recovering
 * (extended, recovering, knockdown, or on cooldown) this is a punish window —
 * reward committing. A long-recovery move is only worth throwing in a real window.
 */
function timing(move: MoveCard, obs: ArenaObservation): number {
  const opp = obs.opponent;
  const punishWindow =
    opp.stance === "extended" ||
    opp.stance === "recovering" ||
    opp.stance === "knockdown" ||
    opp.cooldown > 0;
  const recoveryTicks = movePhysics(move).recoveryTicks;
  const riskOfRecovery = Math.min(1, recoveryTicks / 4);
  if (punishWindow) return 0.5 + 0.5 * (1 - riskOfRecovery * 0.4);
  // Opponent is neutral/stable: throwing a long-recovery move is risky.
  return 0.45 - riskOfRecovery * 0.35;
}

/** Safety term: penalize committing while low on resources / high recovery. */
function safety(move: MoveCard, obs: ArenaObservation): number {
  const phys = movePhysics(move);
  const staminaHeadroom = n(obs.self.stamina - phys.staminaCost);
  const balanceHeadroom = n(obs.self.balance);
  const recoverySafety = n(move.stats.recovery);
  return 0.4 * staminaHeadroom + 0.3 * balanceHeadroom + 0.3 * recoverySafety;
}

/** Style term: how the current intent + persona bias value this move. */
function intentMatch(
  move: MoveCard,
  obs: ArenaObservation,
  intent: Intent,
  bias: BiasWeights,
): number {
  const { inRange } = rangeFit(move, obs.range);
  const reach = movePhysics(move).range;
  const long = n(reach * 50); // longer-reach moves favored by zoners
  const power = n(move.stats.power);
  const safe = n(move.stats.recovery);
  switch (intent) {
    case "pressure":
      return bias.aggression * (0.5 + 0.5 * (inRange ? 1 : 0)) + 0.2 * power;
    case "zone":
      return bias.spacing * (0.4 + 0.6 * long) - (inRange && obs.range < reach * 0.5 ? 0.2 : 0);
    case "counter":
      // Reward patience: only valued highly in a punish window.
      return (
        bias.patience *
        (obs.opponent.stance === "extended" || obs.opponent.cooldown > 0 ? 1 : 0.25)
      );
    case "reset":
      return bias.caution * (0.4 + 0.6 * safe);
  }
}

/** Full utility of throwing `move` right now. Range 0..1-ish before noise. */
export function moveUtility(
  move: MoveCard,
  obs: ArenaObservation,
  intent: Intent,
  bias: BiasWeights,
  difficulty: DifficultyConfig,
  rng: Rng,
): number {
  const { fit, inRange } = rangeFit(move, obs.range);
  const reward = expectedReward(move);
  const t = timing(move, obs);
  const s = safety(move, obs);
  const style = intentMatch(move, obs, intent, bias);

  // payoff (power + expected_reward) minus (stamina + balance_risk + recovery cost)
  const payoff = 0.6 * reward + 0.4 * n(move.stats.power);
  const phys = movePhysics(move);
  const cost =
    0.4 * n(phys.staminaCost) +
    0.4 * n(move.stats.balance_risk) +
    0.2 * Math.min(1, phys.recoveryTicks / 4);

  let utility =
    1.1 * fit + // range fit dominates: a whiff is the worst outcome
    0.8 * t + // timing (whiff-punish / interrupt)
    0.6 * s + // safety
    0.7 * style + // intent / persona style
    0.9 * payoff -
    0.9 * cost;

  // A move we cannot land is heavily demoted (but not impossible — mistakes).
  if (!inRange) utility -= 0.8;

  // Seeded exploration noise (unpredictability knob).
  utility += (rng.next() - 0.5) * 2 * difficulty.noise;
  return utility;
}

/**
 * Rank the deck by utility and choose. With probability `optimal_prob` keep the
 * top move; otherwise drop to a lesser one (controlled imperfection). Returns
 * the chosen move plus whether it is in range, or null for an empty deck.
 */
export function chooseMove(
  obs: ArenaObservation,
  intent: Intent,
  bias: BiasWeights,
  difficulty: DifficultyConfig,
  rng: Rng,
): ScoredMove | null {
  if (!obs.deck.length) return null;
  const scored: ScoredMove[] = obs.deck
    .map((move) => ({
      move,
      utility: moveUtility(move, obs, intent, bias, difficulty, rng),
      inRange: obs.range <= movePhysics(move).range,
    }))
    .sort((a, b) => b.utility - a.utility);

  // Suboptimal play: sometimes pick the 2nd/3rd-best on purpose.
  if (scored.length > 1 && rng.next() > difficulty.optimal_prob) {
    const idx = 1 + rng.int(scored.length - 1);
    return scored[idx];
  }
  return scored[0];
}
