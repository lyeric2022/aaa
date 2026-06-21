import { NextResponse } from "next/server";
import { getRoomSnapshot, resetRoom, submitMove } from "@/lib/arenaRoomStore";
import type { ArenaMove } from "@/lib/arenaCombat";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const snapshot = getRoomSnapshot(id);
  if (!snapshot) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}

export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const token = req.headers.get("x-arena-token");
  if (!token) {
    return NextResponse.json({ error: "Missing arena token" }, { status: 401 });
  }

  const body = (await req.json()) as { action?: string; move?: ArenaMove };
  if (body.action === "reset") {
    const result = resetRoom(id, token);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result.snapshot);
  }

  if (!body.move?.id) {
    return NextResponse.json({ error: "move required" }, { status: 400 });
  }

  const result = submitMove(id, token, body.move);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.snapshot);
}
