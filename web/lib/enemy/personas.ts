// Persona registry. A persona = a STYLE (base intent + bias) combined with
// orthogonal DIFFICULTY knobs. Personas drop into the existing opponent slot
// (fighter_b / Player 2). Adding a persona = adding one entry here.

import { DelayedPerception, EnemyController } from "./controller";
import type { FighterController, Persona } from "./types";

export const PERSONAS: Record<string, Persona> = {
  rusher: {
    id: "rusher",
    name: "Rusher",
    description: "Relentless pressure. Closes range and throws constantly.",
    baseIntent: "pressure",
    difficulty: {
      reaction_delay: 1,
      optimal_prob: 0.7,
      mistake_rate: 0.12,
      adaptation: 0.2,
      noise: 0.25,
    },
    bias: { aggression: 1.0, spacing: 0.1, patience: 0.1, caution: 0.2 },
  },
  zoner: {
    id: "zoner",
    name: "Zoner",
    description: "Keeps you at the tip of its reach and picks at you.",
    baseIntent: "zone",
    difficulty: {
      reaction_delay: 2,
      optimal_prob: 0.78,
      mistake_rate: 0.08,
      adaptation: 0.35,
      noise: 0.18,
    },
    bias: { aggression: 0.2, spacing: 1.0, patience: 0.4, caution: 0.5 },
  },
  counter_puncher: {
    id: "counter_puncher",
    name: "Counter-Puncher",
    description: "Baits commitments and whiff-punishes. Patient and safe.",
    baseIntent: "counter",
    difficulty: {
      reaction_delay: 2,
      optimal_prob: 0.85,
      mistake_rate: 0.05,
      adaptation: 0.6,
      noise: 0.12,
    },
    bias: { aggression: 0.2, spacing: 0.5, patience: 1.0, caution: 0.6 },
  },
  adapter_boss: {
    id: "adapter_boss",
    name: "Adapter-Boss",
    description: "Reads your habits, punishes spam, swaps game-plans on the fly.",
    baseIntent: "pressure",
    difficulty: {
      reaction_delay: 1,
      optimal_prob: 0.92,
      mistake_rate: 0.03,
      adaptation: 1.0,
      noise: 0.1,
    },
    bias: { aggression: 0.7, spacing: 0.6, patience: 0.7, caution: 0.5 },
  },
};

export function listPersonas(): Persona[] {
  return Object.values(PERSONAS);
}

export function getPersona(id: string): Persona | null {
  return PERSONAS[id] ?? null;
}

/**
 * Build a ready-to-use controller for a persona, wrapped in delayed perception
 * per its difficulty so it cannot react frame-perfectly.
 */
export function makePersonaController(persona: Persona): FighterController {
  const brain = new EnemyController(persona);
  return persona.difficulty.reaction_delay > 0
    ? new DelayedPerception(brain, persona.difficulty.reaction_delay)
    : brain;
}
