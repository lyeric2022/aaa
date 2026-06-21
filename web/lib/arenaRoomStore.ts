import { randomBytes } from "node:crypto";
import { resetCall } from "@/lib/announcer";
import {
  advanceFooting,
  applyMove,
  createFighter,
  MOVE_SPEED,
  type ArenaMove,
  type FighterState,
  type FootInput,
  type PlayerSide,
  winnerFor,
} from "@/lib/arenaCombat";

export type ArenaRoomSnapshot = {
  id: string;
  version: number;
  left: FighterState;
  right: FighterState;
  log: string[];
  winner: string | null;
  player2Connected: boolean;
  updatedAt: number;
};

type RoomListener = (snapshot: ArenaRoomSnapshot) => void;

type RoomRecord = {
  id: string;
  version: number;
  left: FighterState;
  right: FighterState;
  log: string[];
  leftToken: string;
  rightToken: string | null;
  player2Connected: boolean;
  lastDecayAt: number;
  leftInput: FootInput;
  rightInput: FootInput;
  listeners: Set<RoomListener>;
};

const NO_INPUT: FootInput = { fwd: 0, strafe: 0 };

const globalForArena = globalThis as typeof globalThis & {
  __arenaRooms?: Map<string, RoomRecord>;
  __arenaDecayTimer?: ReturnType<typeof setInterval>;
};

const rooms = globalForArena.__arenaRooms ?? new Map<string, RoomRecord>();
globalForArena.__arenaRooms = rooms;

// Dev HMR safety: a timer stored on globalThis survives module reloads, so an
// old interval would keep running the previous version's tick logic. Clear any
// stale timer on (re)load and reinstall the current one so live rooms keep
// ticking without needing a fresh request.
if (globalForArena.__arenaDecayTimer) {
  clearInterval(globalForArena.__arenaDecayTimer);
  globalForArena.__arenaDecayTimer = undefined;
}

function makeRoomId() {
  return randomBytes(3).toString("hex");
}

function makeToken() {
  return randomBytes(16).toString("hex");
}

function snapshot(room: RoomRecord): ArenaRoomSnapshot {
  return {
    id: room.id,
    version: room.version,
    left: room.left,
    right: room.right,
    log: room.log,
    winner: winnerFor(room.left, room.right),
    player2Connected: room.player2Connected,
    updatedAt: Date.now(),
  };
}

function bump(room: RoomRecord) {
  room.version += 1;
  const snap = snapshot(room);
  for (const listener of room.listeners) listener(snap);
}

// One authoritative simulation step: advance footwork (turn, walk, collide)
// from each player's held input and fold in decay. Each 40ms tick = one step.
function tickRoom(room: RoomRecord, now: number) {
  const elapsed = now - room.lastDecayAt;
  if (elapsed < 40) return;
  const steps = Math.min(5, Math.floor(elapsed / 40));
  const step = MOVE_SPEED * 0.04; // metres per 40ms tick
  const moving = room.leftInput.fwd || room.leftInput.strafe || room.rightInput.fwd || room.rightInput.strafe;
  for (let i = 0; i < steps; i++) {
    const next = advanceFooting(room.left, room.right, room.leftInput, room.rightInput, now, step);
    room.left = next.left;
    room.right = next.right;
  }
  room.lastDecayAt = now;
  // Always push while anyone is moving so footwork streams live; otherwise only
  // when a decay step actually happened.
  if (steps > 0 || moving) bump(room);
}

function ensureDecayLoop() {
  if (globalForArena.__arenaDecayTimer) return;
  globalForArena.__arenaDecayTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.listeners.size === 0) continue;
      tickRoom(room, now);
    }
  }, 40);
}

// Install the simulation loop now (and after every HMR reload, since the stale
// timer was cleared above) so already-connected rooms keep advancing.
ensureDecayLoop();

export function setRoomInput(
  roomId: string,
  token: string,
  input: FootInput,
): { ok: true } | { ok: false; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: "Room not found" };
  const side = sideForToken(roomId, token);
  if (!side) return { ok: false, error: "Invalid session" };
  const clamped: FootInput = {
    fwd: Math.max(-1, Math.min(1, input.fwd)),
    strafe: Math.max(-1, Math.min(1, input.strafe)),
  };
  if (side === "left") room.leftInput = clamped;
  else room.rightInput = clamped;
  return { ok: true };
}

export function createRoom(): { roomId: string; side: PlayerSide; token: string; snapshot: ArenaRoomSnapshot } {
  ensureDecayLoop();
  const id = makeRoomId();
  const token = makeToken();
  const now = Date.now();
  const room: RoomRecord = {
    id,
    version: 0,
    left: createFighter("Player 1", -1.15, 0),
    right: createFighter("Player 2", 1.15, Math.PI),
    log: ["Waiting for Player 2 to join…"],
    leftToken: token,
    rightToken: null,
    player2Connected: false,
    lastDecayAt: now,
    leftInput: { ...NO_INPUT },
    rightInput: { ...NO_INPUT },
    listeners: new Set(),
  };
  rooms.set(id, room);
  bump(room);
  return { roomId: id, side: "left", token, snapshot: snapshot(room) };
}

export function joinRoom(roomId: string): {
  side: PlayerSide;
  token: string;
  snapshot: ArenaRoomSnapshot;
} | null {
  const room = rooms.get(roomId);
  if (!room || room.player2Connected) return null;
  ensureDecayLoop();
  const token = makeToken();
  room.rightToken = token;
  room.player2Connected = true;
  room.log = ["Player 2 connected. Fight!", ...room.log.slice(0, 3)];
  bump(room);
  return { side: "right", token, snapshot: snapshot(room) };
}

export function getRoomSnapshot(roomId: string): ArenaRoomSnapshot | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  tickRoom(room, Date.now());
  return snapshot(room);
}

export function sideForToken(roomId: string, token: string): PlayerSide | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.leftToken === token) return "left";
  if (room.rightToken === token) return "right";
  return null;
}

export function subscribeRoom(roomId: string, listener: RoomListener): (() => void) | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  ensureDecayLoop();
  room.listeners.add(listener);
  listener(snapshot(room));
  return () => {
    room.listeners.delete(listener);
  };
}

export function submitMove(
  roomId: string,
  token: string,
  move: ArenaMove,
): { ok: true; snapshot: ArenaRoomSnapshot } | { ok: false; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: "Room not found" };
  const side = sideForToken(roomId, token);
  if (!side) return { ok: false, error: "Invalid session" };

  const now = Date.now();
  tickRoom(room, now);
  if (winnerFor(room.left, room.right)) return { ok: false, error: "Match already decided" };

  const result = applyMove(room.left, room.right, side, move, now);
  if (!result) return { ok: false, error: "Cannot act right now" };

  room.left = result.left;
  room.right = result.right;
  room.log = [result.logLine, ...room.log.slice(0, 4)];
  bump(room);
  return { ok: true, snapshot: snapshot(room) };
}

export function resetRoom(
  roomId: string,
  token: string,
): { ok: true; snapshot: ArenaRoomSnapshot } | { ok: false; error: string } {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: "Room not found" };
  if (room.leftToken !== token) return { ok: false, error: "Only Player 1 can reset" };

  const now = Date.now();
  room.left = createFighter("Player 1", -1.15, 0);
  room.right = createFighter("Player 2", 1.15, Math.PI);
  room.leftInput = { ...NO_INPUT };
  room.rightInput = { ...NO_INPUT };
  room.lastDecayAt = now;
  const line = resetCall();
  room.log = [line];
  bump(room);
  return { ok: true, snapshot: snapshot(room) };
}
