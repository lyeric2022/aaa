import { battleCall } from "@/lib/announcer";
import { effectiveReach } from "@/lib/arena-physics";

export type PlayerSide = "left" | "right";
export type MoveAnim = "jab" | "cross" | "hook" | "sweep" | "guard" | "uppercut";

export type ArenaMove = {
  id: string;
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
  recovery: number;
  anim: MoveAnim;
};

export type FighterState = {
  name: string;
  hp: number;
  balance: number;
  stamina: number;
  x: number;
  z: number;
  facing: number;
  walk: number;
  attacking: boolean;
  attackSide: PlayerSide | null;
  /** Which move card is playing (drives per-move arena animation). */
  attackMoveId: string | null;
  attackStart: number;
  attackAnim: MoveAnim | null;
  hitFlash: number;
  recoverUntil: number;
  stance: "stable" | "recovering" | "knockdown";
};

/** Arena animation length — block uses full SONIC clip duration. */
export function attackAnimMs(attackMoveId: string | null): number {
  if (attackMoveId === "block") return 1940;
  return 520;
}

export const MIN_STAMINA_TO_ACT = 30;

// Frontal hit cone: a swing only connects if the opponent is inside this
// angle from straight ahead (cos ~55°). Keeps facing meaningful.
const HIT_CONE_COS = 0.57;

// Ring bounds inset (body clearance so the centre stays inside the ropes).
export const BOUND_X = 2.35 - 0.18;
export const BOUND_Z = 1.75 - 0.18;
// Footwork tuning shared by the local tick and the server room loop.
export const MOVE_SPEED = 2.3; // walking speed in metres/sec
export const TURN_RATE = 0.22; // facing rotation fraction per 40ms tick
export const MIN_GAP = 0.9; // closest the two bodies can get (no overlap)

/** A fighter's footwork intent for one tick (forward/back and strafe, -1..1). */
export type FootInput = { fwd: number; strafe: number };

export const ARENA_BASICS: ArenaMove[] = [
  { id: "basic_jab",   name: "Quick Jab",      speed: 72, power: 11, balanceRisk: 28, recovery: 64, anim: "jab"     },
  { id: "basic_cross", name: "Counter Cross",   speed: 54, power: 22, balanceRisk: 48, recovery: 50, anim: "cross"   },
  { id: "basic_sweep", name: "Low Sweep",       speed: 46, power: 17, balanceRisk: 62, recovery: 44, anim: "sweep"   },
  { id: "basic_guard", name: "Guard Break",     speed: 38, power: 26, balanceRisk: 70, recovery: 36, anim: "guard"   },
];

function clamp(value: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

export function clampToBox(x: number, z: number, hx: number, hz: number): [number, number] {
  return [Math.max(-hx, Math.min(hx, x)), Math.max(-hz, Math.min(hz, z))];
}

/** Shortest-path interpolation between two angles (radians). */
export function angleLerp(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

/** Yaw that points a fighter at (dx, dz). Forward at yaw 0 is +x. */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/**
 * Movement vector relative to a fighter's facing: forward/back runs along the
 * facing, strafe circles around. Normalized so diagonals aren't faster.
 */
export function walkVector(facing: number, fwd: number, strafe: number): [number, number] {
  const fx = Math.cos(facing);
  const fz = -Math.sin(facing);
  const rx = -fz; // right-hand perpendicular in the XZ plane
  const rz = fx;
  const vx = fwd * fx + strafe * rx;
  const vz = fwd * fz + strafe * rz;
  const m = Math.hypot(vx, vz);
  return m > 0 ? [vx / m, vz / m] : [0, 0];
}

/**
 * Apply one footwork step to a fighter: move by (vx, vz) * step, clamp to the
 * ring, push out of the opponent so the two bodies never overlap, and fold in
 * the per-tick decay. `other` is the opponent's pre-move state.
 */
export function resolveFooting(
  p: FighterState,
  vx: number,
  vz: number,
  facing: number,
  other: FighterState,
  now: number,
  step: number,
): FighterState {
  let [nx, nz] = clampToBox(p.x + vx * step, p.z + vz * step, BOUND_X, BOUND_Z);
  let dx = nx - other.x;
  let dz = nz - other.z;
  let d = Math.hypot(dx, dz);
  if (d < MIN_GAP) {
    if (d < 1e-4) {
      dx = nx >= other.x ? 1 : -1;
      dz = 0;
      d = 1;
    }
    nx = other.x + (dx / d) * MIN_GAP;
    nz = other.z + (dz / d) * MIN_GAP;
    [nx, nz] = clampToBox(nx, nz, BOUND_X, BOUND_Z);
  }
  return { ...decayFighter(p, now), x: nx, z: nz, facing, walk: vx || vz ? 1 : 0 };
}

/**
 * Advance both fighters one footwork tick from their movement inputs: each
 * turns to face the other (locked mid-swing), walks per its input (gated to
 * neutral — alive and not recovering), resolves overlap, and decays. Shared by
 * the local single-player tick and the authoritative server room loop.
 */
export function advanceFooting(
  left: FighterState,
  right: FighterState,
  leftInput: FootInput,
  rightInput: FootInput,
  now: number,
  step: number,
): { left: FighterState; right: FighterState } {
  const live = left.hp > 0 && right.hp > 0;
  const leftFacing = left.attacking
    ? left.facing
    : angleLerp(left.facing, faceYaw(right.x - left.x, right.z - left.z), TURN_RATE);
  const rightFacing = right.attacking
    ? right.facing
    : angleLerp(right.facing, faceYaw(left.x - right.x, left.z - right.z), TURN_RATE);

  const lFree = live && now >= left.recoverUntil;
  const rFree = live && now >= right.recoverUntil;
  const [lvx, lvz] = walkVector(leftFacing, lFree ? leftInput.fwd : 0, lFree ? leftInput.strafe : 0);
  const [rvx, rvz] = walkVector(rightFacing, rFree ? rightInput.fwd : 0, rFree ? rightInput.strafe : 0);

  return {
    left: resolveFooting(left, lvx, lvz, leftFacing, right, now, step),
    right: resolveFooting(right, rvx, rvz, rightFacing, left, now, step),
  };
}

/** Pick an animation archetype from a move's stats profile. */
export function animForStats(speed: number, power: number, balanceRisk: number): MoveAnim {
  if (balanceRisk >= 60 && power >= 18) return "sweep";
  if (power >= 24) return "guard";
  if (power >= 18 && balanceRisk >= 40) return "uppercut";
  if (power >= 14) return "cross";
  if (speed >= 60) return "jab";
  return "hook";
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

export function createFighter(name: string, x: number, facing = 0): FighterState {
  return {
    name,
    hp: 100,
    balance: 100,
    stamina: 100,
    x,
    z: 0,
    facing,
    walk: 0,
    attacking: false,
    attackSide: null,
    attackMoveId: null,
    attackStart: 0,
    attackAnim: null,
    hitFlash: 0,
    recoverUntil: 0,
    stance: "stable",
  };
}

export function decayFighter(p: FighterState, now: number): FighterState {
  const recovering = now < p.recoverUntil;
  const animMs = attackAnimMs(p.attackMoveId);
  const swingActive = now - p.attackStart < animMs;
  return {
    ...p,
    hitFlash: Math.max(0, p.hitFlash - 0.08),
    attacking: p.attacking && swingActive,
    attackSide: swingActive ? p.attackSide : null,
    attackMoveId: swingActive ? p.attackMoveId : null,
    attackAnim: swingActive ? p.attackAnim : null,
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

export type MoveResult = {
  left: FighterState;
  right: FighterState;
  logLine: string;
  hit: boolean;
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

  const recoverMs = recoveryMsFor(move);
  const attackerUpdate: FighterState = {
    ...attacker,
    attacking: true,
    attackSide: side,
    attackMoveId: move.id,
    attackStart: now,
    attackAnim: move.anim,
    stamina: clamp(attacker.stamina - cost),
    recoverUntil: now + recoverMs,
    stance: "recovering",
  };

  // 2D hit check: the strike only lands when the opponent is within lunge reach
  // AND inside the attacker's frontal cone. A whiff still commits the attacker
  // (stamina + recovery lock), so throwing into open air has a cost.
  const dx = defender.x - attacker.x;
  const dz = defender.z - attacker.z;
  const gap = Math.hypot(dx, dz) || 1e-4;
  const fwdX = Math.cos(attacker.facing);
  const fwdZ = -Math.sin(attacker.facing);
  const aimDot = (fwdX * dx + fwdZ * dz) / gap;
  const inReach = gap <= effectiveReach(move.speed, move.power);
  const inFront = aimDot >= HIT_CONE_COS;

  if (!inReach || !inFront) {
    const why = !inReach
      ? `${defender.name} is out of range`
      : `${defender.name} slipped to the flank`;
    const logLine = `${attacker.name}'s ${move.name} whiffs — ${why}!`;
    const nextLeft = side === "left" ? attackerUpdate : left;
    const nextRight = side === "right" ? attackerUpdate : right;
    return { left: nextLeft, right: nextRight, logLine, hit: false };
  }

  // Counter hit: striking a recovering or mid-attack opponent lands harder.
  const defenderBusy = now < defender.recoverUntil || defender.attacking;
  const dmg = Math.round(damageFor(move) * (defenderBusy ? 1.6 : 1));
  const bal = Math.round(balanceDamageFor(move) * (defenderBusy ? 1.35 : 1));
  const knock = 0.18 + move.speed / 500;
  // Knockback pushes the defender directly away from the attacker in 2D.
  const knockX = (dx / gap) * knock;
  const knockZ = (dz / gap) * knock;

  const newBalance = clamp(defender.balance - bal);
  const hardStagger = newBalance < 12;
  const staggered = newBalance < 35;
  const stunMs = hardStagger ? 950 : staggered ? 620 : 150;
  const [kx, kz] = clampToBox(defender.x + knockX, defender.z + knockZ, BOUND_X, BOUND_Z);

  const defenderUpdate: FighterState = {
    ...defender,
    hp: clamp(defender.hp - dmg),
    balance: newBalance,
    x: kx,
    z: kz,
    hitFlash: 1,
    recoverUntil: Math.max(defender.recoverUntil, now + stunMs),
    stance: staggered ? "knockdown" : "recovering",
  };

  const counterTag = defenderBusy ? " (counter!)" : "";
  const logLine = battleCall(attacker.name, defender.name, move, dmg) + counterTag;
  const nextLeft = side === "left" ? attackerUpdate : defenderUpdate;
  const nextRight = side === "right" ? attackerUpdate : defenderUpdate;
  return { left: nextLeft, right: nextRight, logLine, hit: true };
}
