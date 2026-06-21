import { describe, expect, it } from "vitest";
import { makeRng } from "../rng";
import { chooseMove, moveUtility } from "../tactician";
import type { BiasWeights, DifficultyConfig } from "../types";
import { makeMove, obs, state } from "./fixtures";

// A long-reach, low-power, safe poke vs a short-reach, high-power, risky haymaker.
const POKE = makeMove("poke", { speed: 95, power: 10, balance_risk: 15, recovery: 85 });
const HAYMAKER = makeMove("haymaker", { speed: 20, power: 95, balance_risk: 85, recovery: 20 });

const CLEAN: DifficultyConfig = {
  reaction_delay: 0,
  optimal_prob: 1,
  mistake_rate: 0,
  adaptation: 0,
  noise: 0,
};

const ZONE_BIAS: BiasWeights = { aggression: 0.2, spacing: 1.0, patience: 0.4, caution: 0.5 };
const PRESSURE_BIAS: BiasWeights = { aggression: 1.0, spacing: 0.1, patience: 0.1, caution: 0.2 };

describe("tactician", () => {
  it("is deterministic for a fixed seed", () => {
    const o = obs({ deck: [POKE, HAYMAKER], range: 0.5 });
    const a = chooseMove(o, "pressure", PRESSURE_BIAS, CLEAN, makeRng(42));
    const b = chooseMove(o, "pressure", PRESSURE_BIAS, CLEAN, makeRng(42));
    expect(a?.move.id).toBe(b?.move.id);
  });

  it("returns null for an empty deck", () => {
    expect(chooseMove(obs({ deck: [] }), "pressure", PRESSURE_BIAS, CLEAN, makeRng(1))).toBeNull();
  });

  it("prefers an in-range move over an out-of-range one", () => {
    // At range 1.9 the haymaker (short reach) cannot land; the poke can.
    const o = obs({ deck: [POKE, HAYMAKER], range: 1.9 });
    const chosen = chooseMove(o, "pressure", PRESSURE_BIAS, CLEAN, makeRng(7));
    expect(chosen?.move.id).toBe("poke");
    expect(chosen?.inRange).toBe(true);
  });

  it("flips the chosen move when intent changes (style is orthogonal)", () => {
    const o = obs({ deck: [POKE, HAYMAKER], range: 0.5 });
    const zonePick = chooseMove(o, "zone", ZONE_BIAS, CLEAN, makeRng(3));
    const pressurePick = chooseMove(o, "pressure", PRESSURE_BIAS, CLEAN, makeRng(3));
    expect(zonePick?.move.id).toBe("poke"); // zoner keeps you out with reach
    expect(pressurePick?.move.id).toBe("haymaker"); // rusher wants the big hit
  });

  it("demotes the risky move via balance_risk / recovery cost in a neutral window", () => {
    const o = obs({ deck: [POKE, HAYMAKER], range: 0.5, opponent: state({ stance: "stable" }) });
    const pokeU = moveUtility(POKE, o, "reset", ZONE_BIAS, CLEAN, makeRng(1));
    const hayU = moveUtility(HAYMAKER, o, "reset", ZONE_BIAS, CLEAN, makeRng(1));
    expect(pokeU).toBeGreaterThan(hayU);
  });

  it("rewards committing in a whiff-punish window", () => {
    const neutral = obs({ deck: [HAYMAKER], range: 0.5, opponent: state({ stance: "stable" }) });
    const punish = obs({
      deck: [HAYMAKER],
      range: 0.5,
      opponent: state({ stance: "extended", cooldown: 2 }),
    });
    const uNeutral = moveUtility(HAYMAKER, neutral, "counter", ZONE_BIAS, CLEAN, makeRng(9));
    const uPunish = moveUtility(HAYMAKER, punish, "counter", ZONE_BIAS, CLEAN, makeRng(9));
    expect(uPunish).toBeGreaterThan(uNeutral);
  });
});
