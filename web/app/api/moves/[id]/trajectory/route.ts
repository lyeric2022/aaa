import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
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

async function candidateJointPaths(id: string, sonicZipPath?: string) {
  const root = process.cwd();
  const repoRoot = path.join(root, "..");
  const paths = [
    path.join(repoRoot, "assets", "motions", `${id}_extracted`, "joint_pos.csv"),
  ];

  if (sonicZipPath) {
    const maybeUploadDir = path.dirname(sonicZipPath);
    const uploadedJointCsv = await findJointCsv(maybeUploadDir);
    if (uploadedJointCsv) paths.unshift(uploadedJointCsv);
  }

  return paths;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  for (const jointPath of await candidateJointPaths(
    id,
    record.move_card.sonic_zip_path,
  )) {
    try {
      const csv = await fs.readFile(jointPath, "utf8");
      const rawFrames = parseCsv(csv);
      const frames = sampleFrames(rawFrames);
      const sourceFps = record.stats?.fps ?? 50;
      const durationSec =
        record.stats?.duration_sec ?? rawFrames.length / Math.max(sourceFps, 1);
      return NextResponse.json({
        id,
        fps: sourceFps,
        playback_fps: frames.length / Math.max(durationSec, 0.001),
        duration_sec: durationSec,
        frames,
        source: jointPath,
        joint_order: "G1 / SONIC 29-DOF IsaacLab order",
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
