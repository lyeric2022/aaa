import { NextResponse } from "next/server";
import {
  applyJudgeToMoveCard,
  judgeMove,
  statsForJudge,
  verdictFromJudge,
} from "@/lib/judgeBridge";
import { getMove, saveMove } from "@/lib/storage";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) {
    return NextResponse.json({ error: "Move not found" }, { status: 404 });
  }

  const card = record.move_card;
  if (card.verdict === "pending" || card.stats.deployability === 0) {
    return NextResponse.json(
      { error: "Move has no scored stats yet. Upload a SONIC zip first." },
      { status: 400 },
    );
  }

  const judgeResult = await judgeMove(card.name, statsForJudge(card.stats), {
    moveId: id,
  });
  if (!judgeResult) {
    return NextResponse.json(
      {
        error:
          "Fetch.ai Judge bridge unavailable. Run: cd agents && .venv/bin/uvicorn web_bridge:app --port 8010",
      },
      { status: 503 },
    );
  }

  const moveCard = applyJudgeToMoveCard(card, judgeResult);
  const stats = record.stats
    ? {
        ...record.stats,
        verdict: verdictFromJudge(judgeResult.deployable, judgeResult.score),
      }
    : null;

  await saveMove({ stats, move_card: moveCard });

  return NextResponse.json({
    judge: moveCard.judge,
    move_card: moveCard,
  });
}
