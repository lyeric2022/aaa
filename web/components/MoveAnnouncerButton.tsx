"use client";

import { useState } from "react";
import { announcer, moveIntroLine } from "@/lib/announcer";

export function MoveAnnouncerButton({
  name,
  speed,
  power,
  balanceRisk,
}: {
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function announce() {
    setStatus("loading");
    try {
      await announcer.speak(moveIntroLine({ name, speed, power, balanceRisk }));
      setStatus("idle");
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <button
      onClick={announce}
      disabled={status === "loading"}
      className="rounded-lg border border-[#7c5cff]/40 bg-[#7c5cff]/10 px-4 py-2 text-sm font-medium text-[#c4b5fd] transition hover:border-[#7c5cff] hover:bg-[#7c5cff]/20 disabled:opacity-60"
    >
      {status === "loading" ? "Generating voice…" : status === "error" ? "Voice failed — check API key" : "🔊 Announce move"}
    </button>
  );
}
