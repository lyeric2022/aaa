import fs from "fs/promises";
import path from "path";
import type { MoveRecord } from "./types";

/** Canonical demo library shown on the home page. */
export const DEFAULT_LIBRARY_MOVE_IDS = [
  "ghost_jab_combo",
  "block",
  "ghost_counter_cross",
  "block_test_judge",
] as const;

export type DefaultLibraryMoveId = (typeof DEFAULT_LIBRARY_MOVE_IDS)[number];

function repoRoot(): string {
  return path.join(process.cwd(), "..");
}

function motionDir(id: string): string {
  return path.join(repoRoot(), "assets", "motions", `${id}_extracted`);
}

function sonicZip(id: string): string {
  return path.join(repoRoot(), "assets", "motions", `${id}_sonic.zip`);
}

function enrichBlock(record: MoveRecord): MoveRecord {
  const root = repoRoot();
  return {
    ...record,
    move_card: {
      ...record.move_card,
      id: "block",
      name: "Block",
      source: "sonic_zip",
      attack_type: "block",
      motion_dir: path.join(root, "assets", "motions", "block_extracted"),
      sonic_zip_path: path.join(root, "assets", "motions", "block_sonic.zip"),
      studio_sonic_validated: true,
      created_at: record.move_card.created_at || new Date().toISOString(),
      coach_feedback:
        record.move_card.coach_feedback ||
        "Hold the guard high and square the hips — low speed and high recovery make this a stable defensive option.",
      pipeline: {
        data: "human recording + studio retarget",
        eval: record.move_card.pipeline?.eval || "joint trajectory heuristics",
        deploy: "sonic zip validated in studio simulate",
      },
    },
  };
}

function enrichGhostJab(record: MoveRecord): MoveRecord {
  const root = repoRoot();
  return {
    ...record,
    move_card: {
      ...record.move_card,
      motion_dir: path.join(root, "assets", "motions", "ghost_jab_combo_extracted"),
      sonic_zip_path:
        record.move_card.sonic_zip_path ||
        path.join(root, "assets", "motions", "ghost_jab_combo_sonic.zip"),
    },
  };
}

function buildGhostCounterCross(ghost: MoveRecord): MoveRecord {
  const root = repoRoot();
  const record = JSON.parse(JSON.stringify(ghost)) as MoveRecord;
  record.move_card.id = "ghost_counter_cross";
  record.move_card.name = "Ghost Counter Cross";
  record.move_card.attack_type = "strike_combo";
  record.move_card.stats = {
    ...record.move_card.stats,
    speed: Math.round(record.move_card.stats.speed * 0.88 * 10) / 10,
    power: Math.round(record.move_card.stats.power * 1.2 * 10) / 10,
    balance_risk: Math.round(record.move_card.stats.balance_risk * 0.82 * 10) / 10,
    deployability: Math.min(
      100,
      Math.round((record.move_card.stats.deployability + 6) * 10) / 10,
    ),
  };
  record.move_card.verdict = "needs_edits";
  record.move_card.coach_feedback =
    "Tighter guard on the cross — good power, watch the lean.";
  record.move_card.judge = undefined;
  record.move_card.motion_dir = path.join(
    root,
    "assets",
    "motions",
    "ghost_jab_combo_extracted",
  );
  record.move_card.sonic_zip_path = path.join(
    root,
    "assets",
    "motions",
    "ghost_jab_combo_sonic.zip",
  );
  record.move_card.pipeline = {
    data: "human recording + studio retarget",
    eval: "joint trajectory heuristics",
    deploy: "sonic zip validated in studio simulate",
  };
  record.move_card.created_at = new Date().toISOString();
  return record;
}

async function readMoveCardsJson(id: string): Promise<MoveRecord | null> {
  try {
    const raw = await fs.readFile(
      path.join(repoRoot(), "move_cards", `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as MoveRecord;
  } catch {
    return null;
  }
}

export async function ensureDefaultLibrary(
  saveMove: (record: MoveRecord) => Promise<void>,
  getMove: (id: string) => Promise<MoveRecord | null>,
): Promise<void> {
  const ghostExisting = await getMove("ghost_jab_combo");
  if (ghostExisting) {
    const enriched = enrichGhostJab(ghostExisting);
    if (
      enriched.move_card.motion_dir !== ghostExisting.move_card.motion_dir ||
      !ghostExisting.move_card.sonic_zip_path
    ) {
      await saveMove(enriched);
    }
  } else {
    const seeded = await readMoveCardsJson("ghost_jab_combo");
    if (seeded) await saveMove(enrichGhostJab(seeded));
  }

  const blockExisting = await getMove("block");
  if (!blockExisting) {
    const seeded = await readMoveCardsJson("block");
    if (seeded) await saveMove(enrichBlock(seeded));
  }

  const crossExisting = await getMove("ghost_counter_cross");
  if (!crossExisting) {
    const ghost =
      (await getMove("ghost_jab_combo")) ||
      (await readMoveCardsJson("ghost_jab_combo"));
    if (ghost) await saveMove(buildGhostCounterCross(enrichGhostJab(ghost)));
  }

  // block_test_judge is kept as-is when present (user-managed ingest artifact).
}

export function defaultMotionDir(id: string): string {
  if (id === "ghost_counter_cross") return motionDir("ghost_jab_combo");
  return motionDir(id);
}

export function defaultSonicZip(id: string): string | null {
  if (id === "ghost_counter_cross") return sonicZip("ghost_jab_combo");
  if (id === "block_test_judge") return null;
  try {
    return sonicZip(id);
  } catch {
    return null;
  }
}
