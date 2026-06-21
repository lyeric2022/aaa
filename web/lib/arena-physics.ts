// Move physics derivation — the single source of truth for turning a scored
// MoveCard into arena physics (reach, impact, costs, recovery). Kept free of
// any Node/fs imports so it is safe to use in the browser (Arena3D) and in the
// enemy brain, not just the server-side simulateFight.

import type { MoveCard } from "./types";

/** Forward lunge during a committed strike — added to standing reach for hit checks. */
export const LUNGE_REACH = 0.5;

function standingRange(speed: number, power: number): number {
  return 0.6 + speed * 0.012 + power * 0.004;
}

/** Effective connect distance: standing reach plus the strike lunge. */
export function effectiveReach(speed: number, power: number): number {
  return standingRange(speed, power) + LUNGE_REACH;
}

export function movePhysics(move: MoveCard) {
  return {
    range: effectiveReach(move.stats.speed, move.stats.power),
    impact: move.stats.power * 0.55 + move.stats.speed * 0.45,
    balanceCost: move.stats.balance_risk * 0.34 + (100 - move.stats.recovery) * 0.1,
    recoveryTicks: Math.max(1, Math.round(1 + (100 - move.stats.recovery) / 28)),
    staminaCost: 10 + move.stats.power * 0.08 + move.stats.speed * 0.05,
    stability: move.stats.smoothness * 0.45 + move.stats.recovery * 0.55,
  };
}
