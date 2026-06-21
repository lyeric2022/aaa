import { NextResponse } from "next/server";
import { createRoom, joinRoom } from "@/lib/arenaRoomStore";

export async function POST(req: Request) {
  let body: { action?: string; roomId?: string } = {};
  const raw = await req.text();
  if (raw.trim()) {
    body = JSON.parse(raw) as { action?: string; roomId?: string };
  }

  if (body.action === "join") {
    if (!body.roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 });
    }
    const joined = joinRoom(body.roomId);
    if (!joined) {
      return NextResponse.json({ error: "Room not found or already full" }, { status: 409 });
    }
    return NextResponse.json({
      roomId: body.roomId,
      side: joined.side,
      token: joined.token,
      snapshot: joined.snapshot,
    });
  }

  const created = createRoom();
  return NextResponse.json({
    roomId: created.roomId,
    side: created.side,
    token: created.token,
    snapshot: created.snapshot,
  });
}
