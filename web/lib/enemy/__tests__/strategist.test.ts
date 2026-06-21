import { describe, expect, it } from "vitest";
import {
  chooseIntent,
  dominantShare,
  emptyPlayerModel,
  observeMove,
} from "../strategist";
import type { DifficultyConfig } from "../types";
import { obs, state } from "./fixtures";

const ADAPTIVE: DifficultyConfig = {
  reaction_delay: 0,
  optimal_prob: 0.9,
  mistake_rate: 0,
  adaptation: 1.0,
  noise: 0,
};
const RIGID: DifficultyConfig = { ...ADAPTIVE, adaptation: 0 };

describe("strategist player model", () => {
  it("tracks move frequency and repeat streaks deterministically", () => {
    const m = emptyPlayerModel();
    observeMove(m, "jab");
    observeMove(m, "jab");
    observeMove(m, "jab");
    observeMove(m, "cross");
    expect(m.total).toBe(4);
    expect(m.freq.jab).toBe(3);
    expect(m.last).toBe("cross");
    expect(m.repeatStreak).toBe(1);
    expect(dominantShare(m)).toBeCloseTo(0.75, 5);
  });
});

describe("strategist intent selection", () => {
  it("switches an adaptive enemy to counter against spam", () => {
    const m = emptyPlayerModel();
    for (let i = 0; i < 4; i++) observeMove(m, "jab");
    const intent = chooseIntent("pressure", obs(), m, ADAPTIVE);
    expect(intent).toBe("counter");
  });

  it("keeps a rigid (low-adaptation) enemy on its base intent despite spam", () => {
    const m = emptyPlayerModel();
    for (let i = 0; i < 4; i++) observeMove(m, "jab");
    expect(chooseIntent("pressure", obs(), m, RIGID)).toBe("pressure");
  });

  it("resets when its own balance/stamina collapse (self-preservation overrides style)", () => {
    const o = obs({ self: state({ balance: 20 }) });
    expect(chooseIntent("pressure", o, emptyPlayerModel(), ADAPTIVE)).toBe("reset");
  });

  it("pressures when the opponent is hurt and we are healthy", () => {
    const o = obs({ self: state({ balance: 80 }), opponent: state({ balance: 30 }) });
    expect(chooseIntent("zone", o, emptyPlayerModel(), ADAPTIVE)).toBe("pressure");
  });
});
