import { battleCall } from "@/lib/announcer";

export type PlayerSide = "left" | "right";

export type ArenaMove = {
  id: string;
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
  recovery: number;
};

export type FighterState = {
  name: string;
  hp: number;
  balance: number;
  stamina: number;
  x: number;
  attacking: boolean;
  attackSide: PlayerSide | null;
  attackStart: number;
  hitFlash: number;
  recoverUntil: number;
  stance: "stable" | "recovering" | "knockdown";
};

export const MIN_STAMINA_TO_ACT = 30;

export const ARENA_BASICS: ArenaMove[] = [
  { id: "basic_jab", name: "Quick Jab", speed: 72, power: 11, balanceRisk: 28, recovery: 64 },
  { id: "basic_cross", name: "Counter Cross", speed: 54, power: 22, balanceRisk: 48, recovery: 50 },
  { id: "basic_sweep", name: "Low Sweep", speed: 46, power: 17, balanceRisk: 62, recovery: 44 },
  { id: "basic_guard", name: "Guard Break", speed: 38, power: 26, balanceRisk: 70, recovery: 36 },
];

function clamp(value: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

export function damageFor(move: ArenaMove) {
  return Math.round(3 + move.power * 0.5 + move.speed * 0.05);
}

export function balanceDamageFor(move: ArenaMove) {
  return Math.round(5 + move.balanceRisk * 0.25 + move.power * 0.12);
}

export function staminaCostFor(move: ArenaMove) {
  return Math.round(18 + move.power * 0.5 + move.speed * 0.1);
}

export function recoveryMsFor(move: ArenaMove) {
  return Math.round(320 + (100 - move.recovery) * 4.5 + move.power * 3);
}

export function createFighter(name: string, x: number): FighterState {
  return {
    name,
    hp: 100,
    balance: 100,
    stamina: 100,
    x,
    attacking: false,
    attackSide: null,
    attackStart: 0,
    hitFlash: 0,
    recoverUntil: 0,
    stance: "stable",
  };
}

export function decayFighter(p: FighterState, now: number): FighterState {
  const recovering = now < p.recoverUntil;
  return {
    ...p,
    hitFlash: Math.max(0, p.hitFlash - 0.08),
    attacking: p.attacking && now - p.attackStart < 520,
    attackSide: now - p.attackStart < 520 ? p.attackSide : null,
    stamina: clamp(p.stamina + (recovering ? 0.4 : 1.0)),
    balance: clamp(p.balance + (recovering ? 0.4 : 1.1)),
    stance: recovering ? p.stance : "stable",
  };
}

export function winnerFor(left: FighterState, right: FighterState): string | null {
  if (left.hp <= 0) return right.name;
  if (right.hp <= 0) return left.name;
  return null;
}

export function canAct(fighter: FighterState, move: ArenaMove, now: number) {
  const cost = staminaCostFor(move);
  return now >= fighter.recoverUntil && fighter.stamina >= cost;
}

export type MoveResult = {
  left: FighterState;
  right: FighterState;
  logLine: string;
  damage: number;
};

export function applyMove(
  left: FighterState,
  right: FighterState,
  side: PlayerSide,
  move: ArenaMove,
  now: number,
): MoveResult | null {
  if (left.hp <= 0 || right.hp <= 0) return null;

  const attacker = side === "left" ? left : right;
  const defender = side === "left" ? right : left;
  const cost = staminaCostFor(move);
  if (now < attacker.recoverUntil || attacker.stamina < cost) return null;

  const defenderBusy = now < defender.recoverUntil || defender.attacking;
  const dmg = Math.round(damageFor(move) * (defenderBusy ? 1.6 : 1));
  const bal = Math.round(balanceDamageFor(move) * (defenderBusy ? 1.35 : 1));
  const knock = 0.18 + move.speed / 500;
  const recoverMs = recoveryMsFor(move);
  const attackerName = attacker.name;
  const defenderName = defender.name;

  const nextAttacker: FighterState = {
    ...attacker,
    attacking: true,
    attackSide: side,
    attackStart: now,
    stamina: clamp(attacker.stamina - cost),
    recoverUntil: now + recoverMs,
    stance: "recovering",
  };

  const applyDefender = (dir: 1 | -1): FighterState => {
    const newBalance = clamp(defender.balance - bal);
    const hardStagger = newBalance < 12;
    const staggered = newBalance < 35;
    const stunMs = hardStagger ? 950 : staggered ? 620 : 150;
    return {
      ...defender,
      hp: clamp(defender.hp - dmg),
      balance: newBalance,
      x: dir === 1 ? Math.min(1.55, defender.x + knock) : Math.max(-1.55, defender.x - knock),
      hitFlash: 1,
      recoverUntil: Math.max(defender.recoverUntil, now + stunMs),
      stance: staggered ? "knockdown" : "recovering",
    };
  };

  const nextLeft = side === "left" ? nextAttacker : applyDefender(-1);
  const nextRight = side === "right" ? nextAttacker : applyDefender(1);
  const counterTag = defenderBusy ? " (counter!)" : "";
  const logLine = battleCall(attackerName, defenderName, move, dmg) + counterTag;

  return { left: nextLeft, right: nextRight, logLine, damage: dmg };
}

export function resetFighters(leftName: string, rightName: string) {
  return {
    left: createFighter(leftName, -1.15),
    right: createFighter(rightName, 1.15),
  };
}
