import { NextResponse } from "next/server";
import { getFighter } from "@/lib/storage";
import { recordFight } from "@/lib/moveMemory";
import { loadMovesForFighters, simulateFight } from "@/lib/arena";
import { getPersona, makePersonaController } from "@/lib/enemy/personas";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    fighter_a: string;
    fighter_b: string;
    /** Optional: drive fighter_b with an AI persona controller. */
    persona_b?: string;
    /** Optional seed for a replayable match. */
    seed?: number;
  };

  const fighterA = await getFighter(body.fighter_a);
  const fighterB = await getFighter(body.fighter_b);

  if (!fighterA || !fighterB) {
    return NextResponse.json({ error: "Fighter not found" }, { status: 404 });
  }

  let controllerB;
  if (body.persona_b) {
    const persona = getPersona(body.persona_b);
    if (!persona) {
      return NextResponse.json({ error: `Unknown persona ${body.persona_b}` }, { status: 400 });
    }
    controllerB = makePersonaController(persona);
  }

  const moveMap = await loadMovesForFighters([fighterA, fighterB]);
  const result = await simulateFight(fighterA, fighterB, moveMap, {
    seed: body.seed,
    controllers: controllerB ? { b: controllerB } : undefined,
  });

  // Fold the result into the Redis historical-performance tables. Move events
  // come straight from the simulated rounds so per-move hit/damage tallies
  // reflect real fights. No-op when Redis is unavailable.
  const moveEvents = result.rounds
    .filter((r) => r.event_type === "hit" || r.event_type === "miss" || r.event_type === "knockdown")
    .map((r) => {
      const card = [...moveMap.values()].find((m) => m.name === r.move_used);
      return card
        ? {
            move_id: card.id,
            hit: r.event_type !== "miss",
            knockdown: r.event_type === "knockdown",
            damage: r.damage,
          }
        : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const winnerId =
    result.winner === fighterA.name
      ? fighterA.id
      : result.winner === fighterB.name
        ? fighterB.id
        : null;

  await recordFight({
    participants: [
      { id: fighterA.id, name: fighterA.name },
      { id: fighterB.id, name: fighterB.name },
    ],
    winner_id: winnerId,
    final_hp: result.final_hp,
    rounds: result.rounds.length,
    source: "headless_sim",
    move_events: moveEvents,
  });

  return NextResponse.json(result);
}
