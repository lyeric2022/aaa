import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getMove, saveMove, publicUploadUrl } from "@/lib/storage";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMove(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("plaza_video") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No video" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "mp4";
  const filename = `${id}_plaza.${ext}`;
  const publicDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(publicDir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(publicDir, filename), buf);

  record.move_card.plaza_video_url = publicUploadUrl(filename);
  record.move_card.pipeline.deploy = "sonic zip deployed on G1 — plaza proof attached";
  await saveMove(record);

  return NextResponse.json(record);
}
