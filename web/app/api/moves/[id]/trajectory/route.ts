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

async function candidateJointPaths(id: string, sonicZipPath?: string) {
  const root = process.cwd();
  const repoRoot = path.join(root, "..");
  const paths = [
    path.join(repoRoot, "assets", "motions", `${id}_extracted`, "joint_pos.csv"),
    path.join(repoRoot, "assets", "motions", "ghost_jab_combo_extracted", "joint_pos.csv"),
  ];

  if (sonicZipPath) {
    const maybeUploadDir = path.dirname(sonicZipPath);
    paths.unshift(path.join(maybeUploadDir, "joint_pos.csv"));
    paths.unshift(path.join(maybeUploadDir, id, "joint_pos.csv"));
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
      const frames = sampleFrames(parseCsv(csv));
      return NextResponse.json({
        id,
        fps: record.stats?.fps ?? 50,
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
