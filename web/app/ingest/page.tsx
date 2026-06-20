"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IngestPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Pick a file");
      return;
    }
    setLoading(true);
    setError("");
    const form = new FormData();
    form.append("name", name || file.name.replace(/\.[^.]+$/, ""));
    form.append("file", file);
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(`/moves/${data.move_card.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-2">Motion ingest</h1>
      <p className="text-[#8888a0] text-sm mb-6 leading-relaxed">
        Upload a <strong className="text-white">SONIC .zip</strong> from Ultimate
        Bots Studio for full scoring, or a <strong className="text-white">video</strong>{" "}
        to store the recording (pair with SONIC later).
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-[#8888a0] mb-1">
            Move name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ghost Jab Combo"
            className="w-full px-3 py-2 rounded-lg bg-[#14141f] border border-[#2a2a3d] focus:border-[#7c5cff] outline-none"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#8888a0] mb-1">
            File
          </label>
          <input
            type="file"
            accept=".zip,.mp4,.webm,.mov"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#7c5cff] file:text-white file:cursor-pointer"
          />
        </div>

        {error && <p className="text-[#ff5c5c] text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-[#7c5cff] font-semibold hover:bg-[#6b4de6] disabled:opacity-50 transition"
        >
          {loading ? "Analyzing…" : "Ingest & score"}
        </button>
      </form>
    </div>
  );
}
