import type {
  Fighter,
  FighterPhysicsState,
  FightResult,
  FightRound,
  MoveCard,
} from "./types";
import { getMove } from "./storage";
import { movePhysics } from "./arena-physics";
import { DEFAULT_SEED, makeRng, type Rng } from "./enemy/rng";
import type {
  ArenaAction,
  ArenaObservation,
  FighterController,
} from "./enemy/types";

export interface SimulateOptions {
  /** Seed for replayable matches (narration + decisions). */
  seed?: number;
  /** Per-fighter controllers. Omit a side to use the seeded-random default. */
  controllers?: { a?: FighterController; b?: FighterController };
  /** Max ticks before the fight is scored on remaining HP. */
  maxTicks?: number;
  /** Effective frame rate the controllers schedule their internal rates against. */
  rateHz?: number;
}

const NARRATION = {
  advance: [
    "{attacker} closes distance, hunting range for {move}.",
    "{attacker} steps in. {defender} gives ground and keeps balance.",
  ],
  hit: [
    "{attacker} fires {move} in range — {damage} damage and {knockback}m knockback.",
    "Clean connect! {attacker}'s {move} lands for {damage}; {defender}'s balance drops.",
    "{defender} eats {move}. The arena sensors mark {damage} damage.",
  ],
  miss: [
    "{defender} slips {move}; {attacker} burns stamina in recovery.",
    "{attacker}'s {move} whiffs outside clean range.",
    "High risk from {attacker}, but {defender} holds the line.",
  ],
  knockdown: [
    "{defender}'s balance breaks after {move}. Knockdown!",
    "{move} tips {defender} past the stability threshold.",
  ],
  recover: [
    "{fighter} resets stance and regains balance.",
    "{fighter} uses the recovery window to stabilize.",
  ],
  ko: [
    "DOWN GOES {loser}! {winner} takes the belt!",
    "It's over! {winner} with the knockout!",
  ],
};

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng.next() * arr.length)];
}

function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? key));
}

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, value));
}

function cloneState(state: FighterPhysicsState): FighterPhysicsState {
  return { ...state };
}

function initialState(name: string, x: number): FighterPhysicsState {
  return {
    name,
    hp: 100,
    x,
    balance: 100,
    stamina: 100,
    cooldown: 0,
    stance: "stable",
  };
}

function distance(a: FighterPhysicsState, b: FighterPhysicsState) {
  return Math.abs(a.x - b.x);
}

function advance(attacker: FighterPhysicsState, defender: FighterPhysicsState) {
  const dir = attacker.x < defender.x ? 1 : -1;
  attacker.x += dir * 0.35;
  attacker.stamina = clamp(attacker.stamina + 4);
  defender.stamina = clamp(defender.stamina + 3);
}

function recover(state: FighterPhysicsState) {
  state.cooldown = Math.max(0, state.cooldown - 1);
  state.balance = clamp(state.balance + (state.stance === "knockdown" ? 18 : 8));
  state.stamina = clamp(state.stamina + 7);
  if (state.balance > 45 && state.cooldown === 0) state.stance = "stable";
}

function applyAttack(
  attacker: FighterPhysicsState,
  defender: FighterPhysicsState,
  move: MoveCard,
) {
  const physics = movePhysics(move);
  const currentRange = distance(attacker, defender);
  const inRange = currentRange <= physics.range;

  attacker.stamina = clamp(attacker.stamina - physics.staminaCost);
  attacker.balance = clamp(attacker.balance - physics.balanceCost * 0.18);
  attacker.cooldown = physics.recoveryTicks;
  attacker.stance = physics.recoveryTicks > 2 ? "extended" : "recovering";

  if (!inRange || attacker.stamina < 8) {
    return {
      hit: false,
      damage: 0,
      knockback: 0,
      balanceLoss: Math.round(physics.balanceCost * 0.25),
      range: currentRange,
      knockdown: false,
    };
  }

  const defense =
    defender.balance * 0.35 + defender.stamina * 0.15 + physics.stability * 0.3;
  const margin = physics.impact - defense * 0.55;
  const damage = Math.min(38, Math.max(7, Math.round(10 + margin * 0.32)));
  const balanceLoss = Math.min(
    55,
    Math.max(8, Math.round(physics.impact * 0.28 + physics.balanceCost * 0.22)),
  );
  const knockback = Math.round((0.12 + physics.impact / 500) * 100) / 100;
  const dir = attacker.x < defender.x ? 1 : -1;

  defender.hp = clamp(defender.hp - damage);
  defender.balance = clamp(defender.balance - balanceLoss);
  defender.x += dir * knockback;
  defender.stance = defender.balance < 30 ? "knockdown" : "recovering";
  defender.cooldown = Math.max(defender.cooldown, defender.stance === "knockdown" ? 2 : 1);

  return {
    hit: true,
    damage,
    knockback,
    balanceLoss,
    range: currentRange,
    knockdown: defender.stance === "knockdown",
  };
}

function buildDeck(
  moveIds: string[],
  moveMap: Map<string, MoveCard>,
): MoveCard[] {
  return moveIds
    .map((id) => moveMap.get(id))
    .filter((m): m is MoveCard => Boolean(m));
}

export async function simulateFight(
  fighterA: Fighter,
  fighterB: Fighter,
  moveMap: Map<string, MoveCard>,
  opts: SimulateOptions = {},
): Promise<FightResult> {
  const rounds: FightRound[] = [];
  const stateA = initialState(fighterA.name, -1.8);
  const stateB = initialState(fighterB.name, 1.8);
  const maxTicks = opts.maxTicks ?? 12;
  const rateHz = opts.rateHz ?? 15;
  const rng = makeRng(opts.seed ?? DEFAULT_SEED);
  const controllerA = opts.controllers?.a;
  const controllerB = opts.controllers?.b;

  for (let tick = 1; tick <= maxTicks && stateA.hp > 0 && stateB.hp > 0; tick++) {
    const aAttacks = tick % 2 === 1;
    const attackerFighter = aAttacks ? fighterA : fighterB;
    const attacker = aAttacks ? stateA : stateB;
    const defender = aAttacks ? stateB : stateA;
    const controller = aAttacks ? controllerA : controllerB;
    const otherController = aAttacks ? controllerB : controllerA;

    recover(stateA);
    recover(stateB);

    if (attacker.cooldown > 0 || attacker.stance === "knockdown") {
      rounds.push({
        round: tick,
        attacker: attacker.name,
        defender: defender.name,
        move_used: "recover",
        damage: 0,
        event_type: "recover",
        narration: interpolate(pick(rng, NARRATION.recover), { fighter: attacker.name }),
        hp_after: { a: stateA.hp, b: stateB.hp },
        states: { a: cloneState(stateA), b: cloneState(stateB) },
      });
      continue;
    }

    const deck = buildDeck(attackerFighter.move_ids, moveMap);
    // Per-frame controller hook — the analog of the human input handler. With
    // no controller we fall back to the legacy (now seeded) random pick.
    let action: ArenaAction;
    if (controller && deck.length) {
      const obs: ArenaObservation = {
        tick,
        rateHz,
        self: attacker,
        opponent: defender,
        deck,
        range: distance(attacker, defender),
      };
      action = controller.decide(obs, rng);
    } else {
      action = { kind: "move", moveId: pick(rng, attackerFighter.move_ids) };
    }

    // "wait" — take the recovery beat instead of committing.
    if (action.kind === "wait") {
      rounds.push({
        round: tick,
        attacker: attacker.name,
        defender: defender.name,
        move_used: "recover",
        damage: 0,
        event_type: "recover",
        narration: interpolate(pick(rng, NARRATION.recover), { fighter: attacker.name }),
        hp_after: { a: stateA.hp, b: stateB.hp },
        states: { a: cloneState(stateA), b: cloneState(stateB) },
      });
      continue;
    }

    // "advance" — footwork toward the opponent (deliberate spacing).
    if (action.kind === "advance") {
      advance(attacker, defender);
      rounds.push({
        round: tick,
        attacker: attacker.name,
        defender: defender.name,
        move_used: "footwork",
        damage: 0,
        event_type: "advance",
        range_m: Math.round(distance(attacker, defender) * 100) / 100,
        narration: interpolate(pick(rng, NARRATION.advance), {
          attacker: attacker.name,
          defender: defender.name,
          move: "footwork",
        }),
        hp_after: { a: stateA.hp, b: stateB.hp },
        states: { a: cloneState(stateA), b: cloneState(stateB) },
      });
      continue;
    }

    const move = moveMap.get(action.moveId);
    if (!move) continue;

    const physics = movePhysics(move);
    if (distance(attacker, defender) > physics.range) {
      advance(attacker, defender);
      rounds.push({
        round: tick,
        attacker: attacker.name,
        defender: defender.name,
        move_used: move.name,
        damage: 0,
        event_type: "advance",
        range_m: Math.round(distance(attacker, defender) * 100) / 100,
        narration: interpolate(pick(rng, NARRATION.advance), {
          attacker: attacker.name,
          defender: defender.name,
          move: move.name,
        }),
        hp_after: { a: stateA.hp, b: stateB.hp },
        states: { a: cloneState(stateA), b: cloneState(stateB) },
      });
      continue;
    }

    const outcome = applyAttack(attacker, defender, move);
    // "player committed a move" observation point — feed the opponent's brain.
    otherController?.observeOpponentMove?.(move.id, {
      hit: outcome.hit,
      damage: outcome.damage,
      knockdown: outcome.knockdown,
      range: outcome.range,
    });
    const eventType = outcome.knockdown ? "knockdown" : outcome.hit ? "hit" : "miss";
    const narration = interpolate(
      pick(rng, outcome.knockdown ? NARRATION.knockdown : outcome.hit ? NARRATION.hit : NARRATION.miss),
      {
        attacker: attacker.name,
        defender: defender.name,
        move: move.name,
        damage: outcome.damage,
        knockback: outcome.knockback,
      },
    );

    rounds.push({
      round: tick,
      attacker: attacker.name,
      defender: defender.name,
      move_used: move.name,
      damage: outcome.damage,
      event_type: eventType,
      range_m: Math.round(outcome.range * 100) / 100,
      knockback_m: outcome.knockback,
      balance_loss: outcome.balanceLoss,
      narration,
      hp_after: { a: stateA.hp, b: stateB.hp },
      states: { a: cloneState(stateA), b: cloneState(stateB) },
    });
  }

  const winner =
    stateA.hp > stateB.hp ? fighterA.name : stateB.hp > stateA.hp ? fighterB.name : "Draw";

  if (winner !== "Draw") {
    const loser = winner === fighterA.name ? fighterB.name : fighterA.name;
    rounds.push({
      round: rounds.length + 1,
      attacker: winner,
      defender: loser,
      move_used: "finisher",
      damage: 0,
      event_type: "ko",
      narration: interpolate(pick(rng, NARRATION.ko), { winner, loser }),
      hp_after: { a: stateA.hp, b: stateB.hp },
      states: { a: cloneState(stateA), b: cloneState(stateB) },
    });
  }

  const result: FightResult = {
    fighter_a: fighterA.name,
    fighter_b: fighterB.name,
    winner,
    rounds,
    final_hp: { a: stateA.hp, b: stateB.hp },
    final_state: { a: cloneState(stateA), b: cloneState(stateB) },
    sim_type: "physics_aware_2d",
  };

  // Between-round hook — out of the frame loop. Attach point for the future
  // LLM meta-coach / persona-author / narrator (no LLM invoked here today).
  controllerA?.onRoundEnd?.({
    result,
    selfName: fighterA.name,
    opponentName: fighterB.name,
  });
  controllerB?.onRoundEnd?.({
    result,
    selfName: fighterB.name,
    opponentName: fighterA.name,
  });

  return result;
}

export async function loadMovesForFighters(
  fighters: Fighter[],
): Promise<Map<string, MoveCard>> {
  const map = new Map<string, MoveCard>();
  const ids = new Set(fighters.flatMap((f) => f.move_ids));
  for (const id of ids) {
    const record = await getMove(id);
    if (record) map.set(id, record.move_card);
  }
  return map;
}
