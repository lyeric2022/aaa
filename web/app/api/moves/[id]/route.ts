import { NextResponse } from "next/server";
import { getMove } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const move = await getMove(id);
  if (!move) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(move);
}
