// Executor (per frame): footwork toward preferred range, else commit the move.
//
// Translates the tactician's chosen move + the current intent into one of the
// three actions the arena loop understands. Pure + synchronous.

import type { Rng } from "./rng";
import type { ArenaAction, DifficultyConfig, Intent } from "./types";
import type { ScoredMove } from "./tactician";

export function execute(
  chosen: ScoredMove | null,
  intent: Intent,
  difficulty: DifficultyConfig,
  obs: { opponent: { stance: string; cooldown: number } },
  rng: Rng,
): ArenaAction {
  // Outright blunder (controlled imperfection): waste the beat.
  if (rng.next() < difficulty.mistake_rate) {
    return rng.next() < 0.5 ? { kind: "wait" } : { kind: "advance" };
  }

  if (!chosen) return { kind: "wait" };

  // Counter-punchers bait: if not yet a punish window, hold instead of throwing.
  const punishWindow =
    obs.opponent.stance === "extended" ||
    obs.opponent.stance === "recovering" ||
    obs.opponent.stance === "knockdown" ||
    obs.opponent.cooldown > 0;
  if (intent === "counter" && !punishWindow && !chosen.inRange) {
    return { kind: "wait" };
  }

  // Reset: prefer to recover when out of range rather than chase.
  if (intent === "reset" && !chosen.inRange) {
    return { kind: "wait" };
  }

  // In range → commit the move. Out of range → footwork toward it (advance).
  return chosen.inRange
    ? { kind: "move", moveId: chosen.move.id }
    : { kind: "advance" };
}
