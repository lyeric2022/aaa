import fs from "fs/promises";
import path from "path";
import type { Fighter, MoveRecord } from "./types";

const DATA = path.join(process.cwd(), "data");
const MOVES_DIR = path.join(DATA, "moves");
const FIGHTERS_DIR = path.join(DATA, "fighters");
const UPLOADS_DIR = path.join(DATA, "uploads");

async function ensureDirs() {
  await fs.mkdir(MOVES_DIR, { recursive: true });
  await fs.mkdir(FIGHTERS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(path.join(process.cwd(), "public", "uploads"), {
    recursive: true,
  });
}

export async function saveMove(record: MoveRecord): Promise<void> {
  await ensureDirs();
  await fs.writeFile(
    path.join(MOVES_DIR, `${record.move_card.id}.json`),
    JSON.stringify(record, null, 2),
  );
}

export async function getMove(id: string): Promise<MoveRecord | null> {
  try {
    const raw = await fs.readFile(path.join(MOVES_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as MoveRecord;
  } catch {
    return null;
  }
}

export async function listMoves(): Promise<MoveRecord[]> {
  await ensureDirs();
  const files = await fs.readdir(MOVES_DIR);
  const moves: MoveRecord[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const raw = await fs.readFile(path.join(MOVES_DIR, file), "utf8");
    moves.push(JSON.parse(raw) as MoveRecord);
  }
  return moves.sort(
    (a, b) =>
      new Date(b.move_card.created_at).getTime() -
      new Date(a.move_card.created_at).getTime(),
  );
}

export async function saveFighter(fighter: Fighter): Promise<void> {
  await ensureDirs();
  await fs.writeFile(
    path.join(FIGHTERS_DIR, `${fighter.id}.json`),
    JSON.stringify(fighter, null, 2),
  );
}

export async function getFighter(id: string): Promise<Fighter | null> {
  try {
    const raw = await fs.readFile(
      path.join(FIGHTERS_DIR, `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as Fighter;
  } catch {
    return null;
  }
}

export async function listFighters(): Promise<Fighter[]> {
  await ensureDirs();
  const files = await fs.readdir(FIGHTERS_DIR);
  const fighters: Fighter[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const raw = await fs.readFile(path.join(FIGHTERS_DIR, file), "utf8");
    fighters.push(JSON.parse(raw) as Fighter);
  }
  return fighters.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function uploadsPath(...parts: string[]) {
  return path.join(UPLOADS_DIR, ...parts);
}

export function publicUploadUrl(filename: string) {
  return `/uploads/${filename}`;
}

export async function seedDemoMove(): Promise<void> {
  const demoPath = path.join(MOVES_DIR, "ghost_jab_combo.json");
  try {
    await fs.access(demoPath);
    return;
  } catch {
    /* seed below */
  }

  const repoDemo = path.join(
    process.cwd(),
    "..",
    "move_cards",
    "ghost_jab_combo.json",
  );
  try {
    const raw = await fs.readFile(repoDemo, "utf8");
    const parsed = JSON.parse(raw) as MoveRecord;
    await saveMove(parsed);

    // Demo sparring partner for arena testing
    const sparPath = path.join(MOVES_DIR, "ghost_counter_cross.json");
    try {
      await fs.access(sparPath);
    } catch {
      const spar = JSON.parse(JSON.stringify(parsed)) as MoveRecord;
      spar.move_card.id = "ghost_counter_cross";
      spar.move_card.name = "Ghost Counter Cross";
      spar.move_card.stats = {
        ...spar.move_card.stats,
        speed: Math.round(spar.move_card.stats.speed * 0.88),
        power: Math.round(spar.move_card.stats.power * 1.2),
        balance_risk: Math.round(spar.move_card.stats.balance_risk * 0.82),
        deployability: Math.min(100, spar.move_card.stats.deployability + 6),
      };
      spar.move_card.coach_feedback =
        "Tighter guard on the cross — good power, watch the lean.";
      await saveMove(spar);
    }
  } catch {
    /* no seed file */
  }
}
