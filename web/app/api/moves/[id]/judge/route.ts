import { NextResponse } from "next/server";
import { getMove } from "@/lib/storage";
import { judgeMove } from "@/lib/judge";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const move = await getMove(id);
  if (!move) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await judgeMove(move.move_card.name, move.move_card.stats);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Judge bridge unavailable";
    return NextResponse.json(
      {
        error: `${message}. Start the agent bridge: cd agents && uvicorn web_bridge:app --port 8010`,
      },
      { status: 502 },
    );
  }
}
