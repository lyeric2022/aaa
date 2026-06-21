import { DeepgramClient } from "@deepgram/sdk";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) {
  console.error("Missing DEEPGRAM_API_KEY. Add it to web/.env.local first.");
  process.exit(1);
}

const text =
  process.argv[2] ??
  "Huge opening strike from Blue Fighter! Ghost Jab Combo lands for 13 damage!";

const dg = new DeepgramClient({ apiKey });
const audio = await dg.speak.v1.audio.generate({
  text,
  model: "aura-2-asteria-en",
});
const buffer = await audio.arrayBuffer();
const out = resolve("test-announcement.mp3");
writeFileSync(out, Buffer.from(buffer));
console.log(`Saved ${out}`);
console.log(`Spoken: "${text}"`);
