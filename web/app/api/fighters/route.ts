import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { aggregateStats } from "@/lib/analyze";
import type { Fighter } from "@/lib/types";
import { getMove, listFighters, saveFighter } from "@/lib/storage";

export async function GET() {
  const fighters = await listFighters();
  return NextResponse.json(fighters);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name: string;
    move_ids: string[];
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  if (!body.move_ids?.length || body.move_ids.length < 1) {
    return NextResponse.json({ error: "Pick at least 1 move" }, { status: 400 });
  }
  if (body.move_ids.length > 5) {
    return NextResponse.json({ error: "Max 5 moves" }, { status: 400 });
  }

  const cards = [];
  for (const id of body.move_ids) {
    const record = await getMove(id);
    if (!record) {
      return NextResponse.json({ error: `Move ${id} not found` }, { status: 404 });
    }
    if (record.move_card.verdict === "pending") {
      return NextResponse.json(
        { error: `${id} needs SONIC scoring first` },
        { status: 400 },
      );
    }
    cards.push(record.move_card);
  }

  const fighter: Fighter = {
    id: uuidv4().slice(0, 8),
    name: body.name.trim(),
    move_ids: body.move_ids,
    stats: aggregateStats(cards),
    created_at: new Date().toISOString(),
  };

  await saveFighter(fighter);
  return NextResponse.json(fighter);
}
