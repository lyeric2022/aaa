import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getMove, publicUploadUrl, saveMove } from "@/lib/storage";
import type { VerificationStatus } from "@/lib/types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const status = (form.get("status") as VerificationStatus) || "passed";
  const notes = (form.get("notes") as string) || "";
  const file = form.get("verification_video") as File | null;

  let videoUrl = record.move_card.verification?.video_url;
  if (file && file.size > 0) {
    const ext = file.name.split(".").pop() ?? "mp4";
    const filename = `${id}_mujoco_verification.${ext}`;
    const publicDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(
      path.join(publicDir, filename),
      Buffer.from(await file.arrayBuffer()),
    );
    videoUrl = publicUploadUrl(filename);
  }

  record.move_card.verification = {
    status,
    backend: file ? "manual_upload" : "gear_sonic_mujoco",
    video_url: videoUrl,
    notes,
    updated_at: new Date().toISOString(),
  };

  if (status === "passed") {
    record.move_card.pipeline.deploy =
      "studio sonic + 3d replay + mujoco verification ready for G1";
  }

  await saveMove(record);
  return NextResponse.json(record);
}
