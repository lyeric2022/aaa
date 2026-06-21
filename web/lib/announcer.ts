type MoveStats = {
  name: string;
  speed: number;
  power: number;
  balanceRisk: number;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function moveIntroLine(move: MoveStats): string {
  const risk =
    move.balanceRisk >= 70
      ? "high balance risk but elite power"
      : move.balanceRisk >= 50
        ? "solid recovery with moderate risk"
        : "clean form and low balance risk";

  return `Introducing ${move.name}! A ${Math.round(move.speed)} speed strike with ${Math.round(move.power)} power — ${risk}.`;
}

export function battleCall(
  attacker: string,
  defender: string,
  move: MoveStats,
  damage: number,
): string {
  const lines = [
    `${attacker} fires ${move.name}! ${damage} damage on ${defender}!`,
    `Huge opening strike from ${attacker}! ${move.name} lands for ${damage}!`,
    `${defender} eats ${move.name} — ${damage} damage recorded by arena sensors.`,
    `Clean connect! ${attacker}'s ${move.name} drops ${defender} for ${damage}!`,
  ];
  return pick(lines);
}

export function koCall(winner: string, loser: string): string {
  return pick([
    `Down goes ${loser}! ${winner} takes the belt!`,
    `It's over! ${winner} with the knockout over ${loser}!`,
  ]);
}

export function resetCall(): string {
  return "Round reset. Both fighters back to full health. Pick your next move.";
}

class Announcer {
  private queue: string[] = [];
  private playing = false;
  private enabled = true;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
    }
  }

  isEnabled() {
    return this.enabled;
  }

  async speak(text: string) {
    if (!this.enabled || !text.trim()) return;
    this.queue.push(text.trim());
    if (!this.playing) {
      await this.drain();
    }
  }

  private async drain() {
    this.playing = true;
    while (this.queue.length > 0) {
      const text = this.queue.shift();
      if (!text) continue;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `TTS failed (${res.status})`);
        }
        const blob = await res.blob();
        await this.playBlob(blob);
      } catch (err) {
        console.warn("Announcer playback failed:", err);
      }
    }
    this.playing = false;
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      audio.play().catch(reject);
    });
  }
}

export const announcer = new Announcer();
