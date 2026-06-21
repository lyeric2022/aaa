// Controllers: the per-frame brains that satisfy the arena's FighterController
// contract (the same contract the human input handler / playMove satisfies).
//
// EnemyController binds the three internal rates (Strategist ~3 Hz, Tactician
// ~15 Hz, Executor per frame) onto the arena's single tick stream. The mapping
// is the adapter boundary: each rate runs "every N frames" where N derives from
// the loop's effective Hz. NO LLM, NO IO anywhere in this path.

import type { Rng } from "./rng";
import { chooseMove, type ScoredMove } from "./tactician";
import { chooseIntent, emptyPlayerModel, noteOutcome, observeMove } from "./strategist";
import { execute } from "./executor";
import type {
  ArenaAction,
  ArenaObservation,
  FighterController,
  Intent,
  MoveOutcome,
  Persona,
  PlayerModel,
  RoundEndSummary,
} from "./types";

function everyNFrames(rateHz: number, targetHz: number): number {
  return Math.max(1, Math.ceil(rateHz / targetHz));
}

export class EnemyController implements FighterController {
  readonly label: string;
  private readonly persona: Persona;
  private readonly model: PlayerModel = emptyPlayerModel();
  private intent: Intent;
  private chosen: ScoredMove | null = null;
  /** Captured for the future (out-of-loop) LLM meta-coach. */
  private roundLog: { tick: number; intent: Intent; moveId: string | null }[] = [];

  constructor(persona: Persona) {
    this.persona = persona;
    this.intent = persona.baseIntent;
    this.label = persona.name;
  }

  decide(obs: ArenaObservation, rng: Rng): ArenaAction {
    const stratEvery = everyNFrames(obs.rateHz, 3);
    const tacEvery = everyNFrames(obs.rateHz, 15);

    // Strategist (~3 Hz): refresh game-plan + intent from the player model.
    if (obs.tick === 1 || obs.tick % stratEvery === 0) {
      this.intent = chooseIntent(
        this.persona.baseIntent,
        obs,
        this.model,
        this.persona.difficulty,
      );
    }

    // Tactician (~15 Hz): re-score the deck under the current intent.
    if (obs.tick === 1 || obs.tick % tacEvery === 0 || this.chosen === null) {
      this.chosen = chooseMove(
        obs,
        this.intent,
        this.persona.bias,
        this.persona.difficulty,
        rng,
      );
    }

    // Executor (per frame): footwork or commit.
    const action = execute(this.chosen, this.intent, this.persona.difficulty, obs, rng);
    this.roundLog.push({
      tick: obs.tick,
      intent: this.intent,
      moveId: action.kind === "move" ? action.moveId : null,
    });
    return action;
  }

  observeOpponentMove(moveId: string, outcome: MoveOutcome): void {
    observeMove(this.model, moveId);
    noteOutcome(this.model, outcome);
  }

  onRoundEnd(summary: RoundEndSummary): void {
    // Out-of-loop attach point for the future meta-coach / persona-author /
    // narrator. Today we just retain the plan log; no LLM is invoked.
    void summary;
    void this.roundLog;
  }
}

/**
 * Seeded random controller — the deterministic analog of the legacy
 * Math.random move-pick. Used as a baseline opponent and in tests.
 */
export class RandomController implements FighterController {
  readonly label: string;
  constructor(label = "Random") {
    this.label = label;
  }
  decide(obs: ArenaObservation, rng: Rng): ArenaAction {
    if (!obs.deck.length) return { kind: "wait" };
    return { kind: "move", moveId: rng.pick(obs.deck).id };
  }
}

/**
 * Delayed-perception wrapper: feeds the inner controller an observation that is
 * `reaction_delay` frames stale, so the enemy cannot react frame-perfectly. It
 * reads the SAME state the player sees — just late.
 */
export class DelayedPerception implements FighterController {
  readonly label: string;
  private readonly inner: FighterController;
  private readonly delay: number;
  private readonly buffer: ArenaObservation[] = [];

  constructor(inner: FighterController, reactionDelay: number) {
    this.inner = inner;
    this.delay = Math.max(0, Math.floor(reactionDelay));
    this.label = inner.label ?? "Delayed";
  }

  decide(obs: ArenaObservation, rng: Rng): ArenaAction {
    this.buffer.push(obs);
    // The action applies NOW, but perception is `delay` frames old.
    const idx = Math.max(0, this.buffer.length - 1 - this.delay);
    const perceived = this.buffer[idx];
    // Keep tick/rate current so the rate scheduler stays aligned; only the
    // perceived world state lags.
    const laggedObs: ArenaObservation = {
      ...perceived,
      tick: obs.tick,
      rateHz: obs.rateHz,
      deck: obs.deck,
    };
    return this.inner.decide(laggedObs, rng);
  }

  observeOpponentMove(moveId: string, outcome: MoveOutcome): void {
    this.inner.observeOpponentMove?.(moveId, outcome);
  }

  onRoundEnd(summary: RoundEndSummary): void {
    this.inner.onRoundEnd?.(summary);
  }
}
