import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { v4 as uuidv4 } from "uuid";
import {
  analyzeJointPositions,
  buildMoveCard,
  parseFps,
  parseJointCsv,
} from "@/lib/analyze";
import type { MoveRecord } from "@/lib/types";
import { saveMove, publicUploadUrl, uploadsPath } from "@/lib/storage";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || `move_${uuidv4().slice(0, 8)}`
  );
}

async function findJointCsv(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === "joint_pos.csv") return full;
    if (e.isDirectory()) {
      const nested = await findJointCsv(full);
      if (nested) return nested;
    }
  }
  return null;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const name = (form.get("name") as string) || "Untitled Move";

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const id = slugify(name);
  const isZip = file.name.endsWith(".zip");
  const isVideo = /\.(mp4|webm|mov)$/i.test(file.name);

  if (!isZip && !isVideo) {
    return NextResponse.json(
      { error: "Upload a SONIC .zip or video (.mp4, .webm, .mov)" },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  if (isZip) {
    const extractDir = uploadsPath(id);
    await fs.mkdir(extractDir, { recursive: true });
    const zipPath = path.join(extractDir, file.name);
    await fs.writeFile(zipPath, buf);

    const zip = new AdmZip(buf);
    zip.extractAllTo(extractDir, true);

    const jointCsvPath = await findJointCsv(extractDir);
    if (!jointCsvPath) {
      return NextResponse.json(
        { error: "No joint_pos.csv found in zip" },
        { status: 400 },
      );
    }

    const jointCsv = await fs.readFile(jointCsvPath, "utf8");
    const positions = parseJointCsv(jointCsv);

    let fps = 50;
    const infoPath = path.join(path.dirname(jointCsvPath), "info.txt");
    try {
      const info = await fs.readFile(infoPath, "utf8");
      fps = parseFps(info);
    } catch {
      /* default fps */
    }

    const motionStats = analyzeJointPositions(positions, fps);
    const moveCard = buildMoveCard(id, name, motionStats, {
      source: "sonic_zip",
      sonicValidated: true,
      sonicZipPath: zipPath,
    });

    const record: MoveRecord = { stats: motionStats, move_card: moveCard };
    await saveMove(record);
    return NextResponse.json(record);
  }

  // Video-only ingest: store file, pending full sonic scoring
  const ext = file.name.split(".").pop() ?? "mp4";
  const filename = `${id}_source.${ext}`;
  const publicDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, filename), buf);

  const pendingStats = {
    duration_sec: 0,
    fps: 0,
    frame_count: 0,
    joint_count: 0,
    peak_velocity: 0,
    mean_velocity: 0,
    smoothness: 0,
    jerk_score: 0,
    extension_risk: 0,
    recovery_score: 0,
    deploy_score: 0,
    verdict: "pending" as const,
  };

  const moveCard = buildMoveCard(id, name, pendingStats, {
    source: "video_upload",
    videoUrl: publicUploadUrl(filename),
  });
  moveCard.coach_feedback =
    "Video saved. Upload a SONIC zip for full joint-trajectory scoring and deploy verdict.";
  moveCard.stats = {
    speed: 0,
    power: 0,
    smoothness: 0,
    balance_risk: 0,
    recovery: 0,
    deployability: 0,
  };

  const record: MoveRecord = { stats: null, move_card: moveCard };
  await saveMove(record);
  return NextResponse.json(record);
}
