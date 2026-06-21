// Strategist (~3 Hz): game-plan + online player-modeling.
//
// Maintains a move-frequency model of the opponent, detects spam (anti-spam
// counter-bias), and selects an Intent (pressure / zone / counter / reset).
// Pure + synchronous — NO LLM, NO IO.

import type {
  ArenaObservation,
  DifficultyConfig,
  Intent,
  MoveOutcome,
  PlayerModel,
} from "./types";

export function emptyPlayerModel(): PlayerModel {
  return { freq: {}, total: 0, repeatStreak: 0 };
}

/** Fold a newly-observed opponent move into the model. */
export function observeMove(model: PlayerModel, moveId: string): void {
  model.freq[moveId] = (model.freq[moveId] ?? 0) + 1;
  model.total += 1;
  if (model.last === moveId) model.repeatStreak += 1;
  else model.repeatStreak = 1;
  model.last = moveId;
}

/** Share of the opponent's most-used move (0..1) — high = predictable/spammy. */
export function dominantShare(model: PlayerModel): number {
  if (!model.total) return 0;
  const max = Math.max(...Object.values(model.freq));
  return max / model.total;
}

/**
 * Choose the game-plan for the next strategist window.
 *
 * Difficulty.adaptation scales how much the online player model is allowed to
 * override the persona's base intent: a low-adaptation persona mostly sticks to
 * its style; a high-adaptation persona (Adapter-Boss) reads the player and
 * punishes spam by switching to `counter`, or resets when it is in danger.
 */
export function chooseIntent(
  baseIntent: Intent,
  obs: ArenaObservation,
  model: PlayerModel,
  difficulty: DifficultyConfig,
): Intent {
  // Self-preservation overrides style when balance/stamina collapse.
  if (obs.self.balance < 28 || obs.self.stamina < 18 || obs.self.stance === "knockdown") {
    return "reset";
  }

  const adapt = difficulty.adaptation;
  if (adapt <= 0) return baseIntent;

  // Anti-spam: if the opponent leans hard on one move (and repeats it), an
  // adaptive enemy shifts to counter to whiff-punish the telegraphed pattern.
  const share = dominantShare(model);
  const spammy = share >= 0.55 && model.total >= 3;
  const repeating = model.repeatStreak >= 3;
  if ((spammy || repeating) && adapt >= 0.4) {
    return "counter";
  }

  // Pressure when the opponent is hurt and we are healthy (close the show out).
  if (obs.opponent.balance < 40 && obs.self.balance > 55 && adapt >= 0.5) {
    return "pressure";
  }

  return baseIntent;
}

/** Convenience: outcome ignored today, reserved for richer modeling later. */
export function noteOutcome(model: PlayerModel, outcome: MoveOutcome): void {
  // Intentionally minimal: frequency modeling lives in observeMove. The hook
  // exists so future strategies (e.g. tracking which of our moves land) attach
  // without changing the controller contract.
  void model;
  void outcome;
}
