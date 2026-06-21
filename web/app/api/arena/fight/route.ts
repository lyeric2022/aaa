import { NextResponse } from "next/server";
import { getFighter } from "@/lib/storage";
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
  return NextResponse.json(result);
}
