import { NextResponse } from "next/server";
import { seedDemoMove, listMoves } from "@/lib/storage";

export async function GET() {
  await seedDemoMove();
  const moves = await listMoves();
  return NextResponse.json(moves);
}
