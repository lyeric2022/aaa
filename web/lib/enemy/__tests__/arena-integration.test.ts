import { describe, expect, it } from "vitest";
import type { MoveCard } from "../../types";
import { simulateFight } from "../../arena";
import { EnemyController } from "../controller";
import { PERSONAS } from "../personas";
import { evaluateDeck } from "../evaluate";
import type { ArenaAction, ArenaObservation, FighterController } from "../types";
import { makeFighter, makeMove } from "./fixtures";

const POKE = makeMove("poke", { speed: 90, power: 20, balance_risk: 20, recovery: 80 }, "Poke");
const HAYMAKER = makeMove("haymaker", { speed: 30, power: 90, balance_risk: 80, recovery: 25 }, "Haymaker");
const MOVE_MAP = new Map<string, MoveCard>([
  ["poke", POKE],
  ["haymaker", HAYMAKER],
]);

const PLAYER = makeFighter("Player", ["poke", "haymaker"]);
const ENEMY = makeFighter("Enemy", ["poke", "haymaker"]);

/** A scripted/mocked player: always throws the first deck move (no randomness). */
class ScriptedPlayer implements FighterController {
  readonly label = "Scripted";
  decide(o: ArenaObservation): ArenaAction {
    return { kind: "move", moveId: o.deck[0].id };
  }
}

describe("real arena integration (offline)", () => {
  it("drives the REAL simulateFight with a scripted player vs an enemy persona", async () => {
    const result = await simulateFight(PLAYER, ENEMY, MOVE_MAP, {
      seed: 123,
      controllers: {
        a: new ScriptedPlayer(),
        b: new EnemyController(PERSONAS.counter_puncher),
      },
    });
    expect(result.rounds.length).toBeGreaterThan(0);
    expect([PLAYER.name, ENEMY.name, "Draw"]).toContain(result.winner);
  });

  it("is replayable: the same seed reproduces an identical transcript", async () => {
    const run = () =>
      simulateFight(PLAYER, ENEMY, MOVE_MAP, {
        seed: 999,
        controllers: { b: new EnemyController(PERSONAS.rusher) },
      });
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds can produce different transcripts", async () => {
    const a = await simulateFight(PLAYER, ENEMY, MOVE_MAP, {
      seed: 1,
      controllers: { b: new EnemyController(PERSONAS.adapter_boss) },
    });
    const b = await simulateFight(PLAYER, ENEMY, MOVE_MAP, {
      seed: 2,
      controllers: { b: new EnemyController(PERSONAS.adapter_boss) },
    });
    // Not a hard guarantee, but with these seeds the transcripts diverge.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("legacy no-controller call still returns a valid FightResult", async () => {
    const result = await simulateFight(PLAYER, ENEMY, MOVE_MAP, { seed: 5 });
    expect(result.sim_type).toBe("physics_aware_2d");
    expect(result.rounds.length).toBeGreaterThan(0);
  });
});

describe("evaluation harness (real arena)", () => {
  it("produces a competition-readiness profile across the persona pool", async () => {
    const profile = await evaluateDeck(PLAYER, MOVE_MAP, { matchesPerPersona: 3, baseSeed: 7 });
    expect(profile.matchups).toHaveLength(Object.keys(PERSONAS).length);
    expect(profile.deployability).toBe(PLAYER.stats.deployability);
    expect(profile.readinessScore).toBeGreaterThanOrEqual(0);
    expect(profile.readinessScore).toBeLessThanOrEqual(100);
    for (const m of profile.matchups) {
      expect(m.winRate).toBeGreaterThanOrEqual(0);
      expect(m.winRate).toBeLessThanOrEqual(1);
      expect(m.whyItLoses.length).toBeGreaterThan(0);
    }
  });

  it("is replayable for a fixed base seed", async () => {
    const a = await evaluateDeck(PLAYER, MOVE_MAP, { matchesPerPersona: 3, baseSeed: 7 });
    const b = await evaluateDeck(PLAYER, MOVE_MAP, { matchesPerPersona: 3, baseSeed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
