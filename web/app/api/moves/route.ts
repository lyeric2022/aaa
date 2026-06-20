import { NextResponse } from "next/server";
import { listMoves } from "@/lib/storage";

export async function GET() {
  const moves = await listMoves();
  return NextResponse.json(moves);
}
