import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/deepgram";

export async function GET() {
  const configured = Boolean(process.env.DEEPGRAM_API_KEY);
  return NextResponse.json({ configured });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; model?: string };
    if (!body.text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const stream = await synthesizeSpeech(body.text, body.model);
    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    const status = message.includes("DEEPGRAM_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
