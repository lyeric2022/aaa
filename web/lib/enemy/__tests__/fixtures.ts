// Offline, in-memory test fixtures. No fs / network / THREE.

import type { Fighter, MoveCard } from "../../types";
import type { ArenaObservation, FighterPhysicsLike } from "../types";

export function makeMove(id: string, stats: Partial<MoveCard["stats"]>, name = id): MoveCard {
  return {
    id,
    name,
    source: "sonic_zip",
    attack_type: "strike_combo",
    studio_sonic_validated: true,
    stats: {
      speed: 50,
      power: 50,
      smoothness: 80,
      balance_risk: 40,
      recovery: 60,
      deployability: 70,
      ...stats,
    },
    verdict: "safe",
    coach_feedback: "",
    created_at: "1970-01-01T00:00:00.000Z",
    pipeline: { data: "test", eval: "test", deploy: "test" },
  };
}

export function makeFighter(name: string, moveIds: string[], deployability = 70): Fighter {
  return {
    id: name.toLowerCase(),
    name,
    move_ids: moveIds,
    stats: {
      speed: 50,
      power: 50,
      smoothness: 80,
      balance_risk: 40,
      recovery: 60,
      deployability,
    },
    created_at: "1970-01-01T00:00:00.000Z",
  };
}

export function state(overrides: Partial<FighterPhysicsLike> = {}): FighterPhysicsLike {
  return {
    hp: 100,
    x: 0,
    balance: 100,
    stamina: 100,
    cooldown: 0,
    stance: "stable",
    ...overrides,
  };
}

export function obs(overrides: Partial<ArenaObservation> = {}): ArenaObservation {
  return {
    tick: 1,
    rateHz: 15,
    self: state(),
    opponent: state(),
    deck: [],
    range: 0.5,
    ...overrides,
  };
}
