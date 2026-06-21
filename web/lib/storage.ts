import fs from "fs/promises";
import path from "path";
import type { Fighter, MoveRecord } from "./types";
import { ensureDefaultLibrary } from "./defaultMoves";

const DATA = path.join(process.cwd(), "data");
const MOVES_DIR = path.join(DATA, "moves");
const FIGHTERS_DIR = path.join(DATA, "fighters");
const UPLOADS_DIR = path.join(DATA, "uploads");

/** Serialize writes per move id so concurrent judge saves cannot interleave. */
const moveWriteChains = new Map<string, Promise<void>>();

async function ensureDirs() {
  await fs.mkdir(MOVES_DIR, { recursive: true });
  await fs.mkdir(FIGHTERS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(path.join(process.cwd(), "public", "uploads"), {
    recursive: true,
  });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

async function writeMoveRecord(record: MoveRecord): Promise<void> {
  await ensureDirs();
  await writeJsonAtomic(
    path.join(MOVES_DIR, `${record.move_card.id}.json`),
    record,
  );
}

export async function saveMove(record: MoveRecord): Promise<void> {
  const id = record.move_card.id;
  const prev = moveWriteChains.get(id) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      /* keep the chain alive after a failed write */
    })
    .then(() => writeMoveRecord(record));
  moveWriteChains.set(id, next);
  try {
    await next;
  } finally {
    if (moveWriteChains.get(id) === next) {
      moveWriteChains.delete(id);
    }
  }
}

async function readMoveFile(id: string): Promise<MoveRecord | null> {
  const candidateIds = id.endsWith("_sonic")
    ? [id, id.replace(/_sonic$/, "")]
    : [id];

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
}

let libraryEnsured = false;

async function ensureLibraryOnce(): Promise<void> {
  if (libraryEnsured) return;
  await ensureDefaultLibrary(saveMove, readMoveFile);
  libraryEnsured = true;
}

export async function getMove(id: string): Promise<MoveRecord | null> {
  await ensureDirs();
  await ensureLibraryOnce();
  return readMoveFile(id);
}

export async function listMoves(): Promise<MoveRecord[]> {
  await ensureDirs();
  await ensureLibraryOnce();
  const files = await fs.readdir(MOVES_DIR);
  const moves: MoveRecord[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = await fs.readFile(path.join(MOVES_DIR, file), "utf8");
      moves.push(JSON.parse(raw) as MoveRecord);
    } catch {
      // Skip corrupt files so one bad save cannot take down the app.
    }
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

/** @deprecated Use ensureDefaultLibrary via listMoves/getMove instead. */
export async function seedDemoMove(): Promise<void> {
  libraryEnsured = false;
  await ensureLibraryOnce();
}
