"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArenaRoomSnapshot } from "@/lib/arenaRoomStore";
import type { ArenaMove, FighterState, FootInput, PlayerSide } from "@/lib/arenaCombat";

const TOKEN_PREFIX = "arena-token:";

function tokenKey(roomId: string) {
  return `${TOKEN_PREFIX}${roomId}`;
}

export type ArenaMultiplayerStatus =
  | "idle"
  | "connecting"
  | "waiting"
  | "live"
  | "error";

export function useArenaMultiplayer({
  enabled,
  roomId,
  playerSide,
}: {
  enabled: boolean;
  roomId: string | null;
  playerSide: PlayerSide;
}) {
  const [status, setStatus] = useState<ArenaMultiplayerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(roomId);
  const [token, setToken] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ArenaRoomSnapshot | null>(null);
  const lastLogRef = useRef<string | null>(null);
  const onLogLineRef = useRef<((line: string) => void) | null>(null);

  const applySnapshot = useCallback((next: ArenaRoomSnapshot) => {
    setSnapshot(next);
    const newest = next.log[0];
    if (newest && newest !== lastLogRef.current) {
      lastLogRef.current = newest;
      onLogLineRef.current?.(newest);
    }
    setStatus(next.player2Connected ? "live" : playerSide === "left" ? "waiting" : "live");
  }, [playerSide]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setSnapshot(null);
      setToken(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;

    async function boot() {
      setStatus("connecting");
      setError(null);

      try {
        let activeRoomId = roomId;
        let activeToken: string | null = null;

        if (playerSide === "right") {
          if (!activeRoomId) {
            throw new Error("Missing room code — open the link Player 1 shared.");
          }
          const stored = sessionStorage.getItem(tokenKey(activeRoomId));
          if (stored) {
            activeToken = stored;
          } else {
            const res = await fetch("/api/arena/room", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "join", roomId: activeRoomId }),
            });
            if (!res.ok) {
              const data = (await res.json()) as { error?: string };
              throw new Error(data.error ?? "Could not join room");
            }
            const data = (await res.json()) as {
              roomId: string;
              token: string;
              snapshot: ArenaRoomSnapshot;
            };
            activeRoomId = data.roomId;
            activeToken = data.token;
            sessionStorage.setItem(tokenKey(activeRoomId), activeToken);
          }
        } else {
          if (activeRoomId) {
            activeToken = sessionStorage.getItem(tokenKey(activeRoomId));
          }
          if (!activeRoomId || !activeToken) {
            const res = await fetch("/api/arena/room", { method: "POST" });
            const data = (await res.json()) as {
              roomId: string;
              token: string;
              snapshot: ArenaRoomSnapshot;
            };
            activeRoomId = data.roomId;
            activeToken = data.token;
            sessionStorage.setItem(tokenKey(activeRoomId), activeToken);
          }
        }

        if (cancelled || !activeRoomId || !activeToken) return;

        setRoomCode(activeRoomId);
        setToken(activeToken);

        eventSource = new EventSource(`/api/arena/room/${activeRoomId}/events`);
        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data) as ArenaRoomSnapshot | { error?: string };
          if ("error" in data && data.error) {
            setError(data.error);
            setStatus("error");
            return;
          }
          applySnapshot(data as ArenaRoomSnapshot);
        };
        eventSource.onerror = () => {
          if (!cancelled) {
            setError("Lost connection to arena room");
            setStatus("error");
          }
        };
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Multiplayer connection failed");
          setStatus("error");
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [enabled, roomId, playerSide, applySnapshot]);

  const playRemoteMove = useCallback(
    async (move: ArenaMove) => {
      if (!roomCode || !token) return false;
      const res = await fetch(`/api/arena/room/${roomCode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-arena-token": token,
        },
        body: JSON.stringify({ action: "move", move }),
      });
      if (!res.ok) return false;
      const next = (await res.json()) as ArenaRoomSnapshot;
      applySnapshot(next);
      return true;
    },
    [roomCode, token, applySnapshot],
  );

  // Stream this player's footwork intent to the server. Deduped so we only POST
  // when the held direction actually changes (key down/up), not every frame.
  const lastInputRef = useRef<string>("0,0");
  const sendInput = useCallback(
    (input: FootInput) => {
      if (!roomCode || !token) return;
      const sig = `${input.fwd},${input.strafe}`;
      if (sig === lastInputRef.current) return;
      lastInputRef.current = sig;
      void fetch(`/api/arena/room/${roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-arena-token": token },
        body: JSON.stringify({ action: "input", input }),
      }).catch(() => {
        // Let the next change retry; movement is best-effort.
        lastInputRef.current = "";
      });
    },
    [roomCode, token],
  );

  const resetRemote = useCallback(async () => {
    if (!roomCode || !token) return false;
    const res = await fetch(`/api/arena/room/${roomCode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-arena-token": token,
      },
      body: JSON.stringify({ action: "reset" }),
    });
    if (!res.ok) return false;
    const next = (await res.json()) as ArenaRoomSnapshot;
    lastLogRef.current = null;
    applySnapshot(next);
    return true;
  }, [roomCode, token, applySnapshot]);

  const setOnLogLine = useCallback((fn: ((line: string) => void) | null) => {
    onLogLineRef.current = fn;
  }, []);

  const fightersFromSnapshot = (): { left: FighterState; right: FighterState; log: string[] } | null => {
    if (!snapshot) return null;
    return { left: snapshot.left, right: snapshot.right, log: snapshot.log };
  };

  return {
    status,
    error,
    roomCode,
    token,
    snapshot,
    playRemoteMove,
    sendInput,
    resetRemote,
    setOnLogLine,
    fightersFromSnapshot,
    isMultiplayer: enabled && !!token && status !== "error" && status !== "idle",
  };
}

export function buildArenaShareUrl(roomCode: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/arena?player=2&room=${roomCode}`;
}

export function buildHostArenaUrl(roomCode: string, origin?: string) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/arena?room=${roomCode}`;
}
