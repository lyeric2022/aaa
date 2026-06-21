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
  await seedDemoMove();
  const candidateIds = id.endsWith("_sonic")
    ? [id, id.replace(/_sonic$/, "")]
    : [id];

  try {
    for (const candidateId of candidateIds) {
      try {
        const raw = await fs.readFile(
          path.join(MOVES_DIR, `${candidateId}.json`),
          "utf8",
        );
        return JSON.parse(raw) as MoveRecord;
      } catch {
        /* try next candidate */
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function listMoves(): Promise<MoveRecord[]> {
  await seedDemoMove();
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
    const raw = await fs.readFile(path.join(FIGHTERS_DIR, `${id}.json`), "utf8");
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

export function uploadsPath(id: string) {
  return path.join(UPLOADS_DIR, id);
}

export function publicUploadUrl(filename: string) {
  return `/uploads/${filename}`;
}

function enrichSeededMove(record: MoveRecord, repoRoot: string): MoveRecord {
  if (record.move_card.id !== "block") return record;
  return {
    ...record,
    move_card: {
      ...record.move_card,
      source: "sonic_zip",
      attack_type: "block",
      sonic_zip_path: path.join(repoRoot, "assets/motions/block_sonic.zip"),
      created_at: record.move_card.created_at || new Date().toISOString(),
      coach_feedback:
        "Hold the guard high and square the hips — low speed and high recovery make this a stable defensive option.",
    },
  };
}

export async function seedDemoMove(): Promise<void> {
  const repoDemoDir = path.join(process.cwd(), "..", "move_cards");
  const repoRoot = path.join(process.cwd(), "..");

  try {
    const demoFiles = await fs.readdir(repoDemoDir);
    for (const file of demoFiles.filter((f) => f.endsWith(".json"))) {
      const id = file.replace(/\.json$/, "");
      const dest = path.join(MOVES_DIR, `${id}.json`);
      try {
        await fs.access(dest);
        continue;
      } catch {
        /* seed below */
      }
      const raw = await fs.readFile(path.join(repoDemoDir, file), "utf8");
      const parsed = enrichSeededMove(JSON.parse(raw) as MoveRecord, repoRoot);
      await saveMove(parsed);
    }
  } catch {
    /* no seed dir */
  }

  const sparPath = path.join(MOVES_DIR, "ghost_counter_cross.json");
  try {
    await fs.access(sparPath);
  } catch {
    const ghost = await getMove("ghost_jab_combo");
    if (!ghost) return;
    const spar = JSON.parse(JSON.stringify(ghost)) as MoveRecord;
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
}
