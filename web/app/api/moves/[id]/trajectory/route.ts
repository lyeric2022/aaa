import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { remapIsaacLabFrames } from "@/lib/g1Motion";
import { getMove } from "@/lib/storage";

function parseCsv(csv: string): number[][] {
  const lines = csv.trim().split("\n");
  return lines.slice(1).map((line) => line.split(",").map(Number));
}

function sampleFrames(frames: number[][], maxFrames = 240): number[][] {
  if (frames.length <= maxFrames) return frames;
  const step = frames.length / maxFrames;
  return Array.from({ length: maxFrames }, (_, i) => frames[Math.floor(i * step)]);
}

async function findJointCsv(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === "joint_pos.csv") return full;
      if (entry.isDirectory()) {
        const nested = await findJointCsv(full);
        if (nested) return nested;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function candidateJointPaths(
  id: string,
  sonicZipPath?: string,
  motionDir?: string,
) {
  const root = process.cwd();
  const repoRoot = path.join(root, "..");
  const paths: string[] = [];

  if (motionDir) {
    paths.push(path.join(motionDir, "joint_pos.csv"));
  }

  paths.push(
    path.join(repoRoot, "assets", "motions", `${id}_extracted`, "joint_pos.csv"),
  );

  if (id === "ghost_counter_cross") {
    paths.push(
      path.join(
        repoRoot,
        "assets",
        "motions",
        "ghost_jab_combo_extracted",
        "joint_pos.csv",
      ),
    );
  }

  paths.push(
    path.join(
      root,
      "data",
      "gear_sonic_reference",
      "ghost_fighter",
      "ghost_jab_combo_extracted",
      "joint_pos.csv",
    ),
  );

  if (sonicZipPath) {
    const zipDir = path.dirname(sonicZipPath);
    const zipBase = path.basename(sonicZipPath, path.extname(sonicZipPath));
    const extractedBesideZip = path.join(
      zipDir,
      `${zipBase.replace(/_sonic$/, "")}_extracted`,
      "joint_pos.csv",
    );
    const extractedById = path.join(zipDir, `${id}_extracted`, "joint_pos.csv");
    const uploadExtracted = await findJointCsv(zipDir);
    if (uploadExtracted) paths.unshift(uploadExtracted);
    for (const candidate of [extractedById, extractedBesideZip]) {
      try {
        await fs.access(candidate);
        paths.unshift(candidate);
      } catch {
        /* try next */
      }
    }
  }

  return [...new Set(paths)];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const trajectoryId = record.move_card.id || id.replace(/_sonic$/, "");

  for (const jointPath of await candidateJointPaths(
    trajectoryId,
    record.move_card.sonic_zip_path,
    record.move_card.motion_dir,
  )) {
    try {
      const csv = await fs.readFile(jointPath, "utf8");
      const rawFrames = parseCsv(csv);
      const mujocoFrames = remapIsaacLabFrames(rawFrames);
      const frames = sampleFrames(mujocoFrames);
      const sourceFps = record.stats?.fps ?? 50;
      const durationSec =
        record.stats?.duration_sec ?? rawFrames.length / Math.max(sourceFps, 1);
      return NextResponse.json({
        id: trajectoryId,
        fps: sourceFps,
        playback_fps: frames.length / Math.max(durationSec, 0.001),
        duration_sec: durationSec,
        frames,
        source: jointPath,
        joint_order: "G1 29-DOF MuJoCo / Unitree SDK order",
      });
    } catch {
      // Try the next candidate path.
    }
  }

  return NextResponse.json(
    { error: "No joint_pos.csv available for this move" },
    { status: 404 },
  );
}
