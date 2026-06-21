import { DeepgramClient } from "@deepgram/sdk";

export const DEEPGRAM_TTS_MODEL = "aura-2-asteria-en";

export function getDeepgramClient() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set");
  }
  return new DeepgramClient({ apiKey });
}

export async function synthesizeSpeech(text: string, model = DEEPGRAM_TTS_MODEL) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Text is required");
  }

  const dg = getDeepgramClient();
  const audio = await dg.speak.v1.audio.generate({
    text: trimmed,
    model,
  });
  const stream = audio.stream();
  if (!stream) {
    throw new Error("Deepgram returned no audio stream");
  }
  return stream;
}
