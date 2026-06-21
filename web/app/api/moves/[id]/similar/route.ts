import { NextResponse } from "next/server";
import { similarMoves } from "@/lib/moveMemory";

// GET /api/moves/[id]/similar?k=5
// Feature-vector similarity search over the Redis move-memory layer. Returns an
// empty list when Redis is unavailable (similarity is a Redis-backed feature).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const k = Number(new URL(req.url).searchParams.get("k")) || 5;
  const similar = await similarMoves(id, Math.max(1, Math.min(20, k)));
  return NextResponse.json({ id, similar });
}
