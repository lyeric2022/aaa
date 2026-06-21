import { NextResponse } from "next/server";
import { getLeaderboards } from "@/lib/leaderboard";

export async function GET() {
  const { moves, fighters } = await getLeaderboards();
  return NextResponse.json({ moves, fighters });
}
