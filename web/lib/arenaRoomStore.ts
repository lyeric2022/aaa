import { randomBytes } from "node:crypto";
import { resetCall } from "@/lib/announcer";
import {
  applyMove,
  createFighter,
  decayFighter,
  type ArenaMove,
  type FighterState,
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
  listeners: Set<RoomListener>;
};

const globalForArena = globalThis as typeof globalThis & {
  __arenaRooms?: Map<string, RoomRecord>;
  __arenaDecayTimer?: ReturnType<typeof setInterval>;
};

const rooms = globalForArena.__arenaRooms ?? new Map<string, RoomRecord>();
globalForArena.__arenaRooms = rooms;

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

function decayRoom(room: RoomRecord, now: number) {
  const elapsed = now - room.lastDecayAt;
  if (elapsed < 40) return;
  const steps = Math.min(5, Math.floor(elapsed / 40));
  for (let i = 0; i < steps; i++) {
    room.left = decayFighter(room.left, now);
    room.right = decayFighter(room.right, now);
  }
  room.lastDecayAt = now;
  if (steps > 0) bump(room);
}

function ensureDecayLoop() {
  if (globalForArena.__arenaDecayTimer) return;
  globalForArena.__arenaDecayTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.listeners.size === 0) continue;
      decayRoom(room, now);
    }
  }, 40);
}

export function createRoom(): { roomId: string; side: PlayerSide; token: string; snapshot: ArenaRoomSnapshot } {
  ensureDecayLoop();
  const id = makeRoomId();
  const token = makeToken();
  const now = Date.now();
  const room: RoomRecord = {
    id,
    version: 0,
    left: createFighter("Player 1", -1.15),
    right: createFighter("Player 2", 1.15),
    log: ["Waiting for Player 2 to join…"],
    leftToken: token,
    rightToken: null,
    player2Connected: false,
    lastDecayAt: now,
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
  decayRoom(room, Date.now());
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
  decayRoom(room, now);
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
  room.left = createFighter("Player 1", -1.15);
  room.right = createFighter("Player 2", 1.15);
  room.lastDecayAt = now;
  const line = resetCall();
  room.log = [line];
  bump(room);
  return { ok: true, snapshot: snapshot(room) };
}
