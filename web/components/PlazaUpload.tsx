"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlazaUpload({
  moveId,
  hasPlaza,
}: {
  moveId: string;
  hasPlaza: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (hasPlaza) return null;

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setLoading(true);
    try {
      const res = await fetch(`/api/moves/${moveId}/plaza`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={upload} className="mt-6 p-4 border border-[#3dd68c]/30 rounded-xl bg-[#3dd68c]/5">
      <p className="text-sm font-medium text-[#3dd68c] mb-2">
        Add plaza proof (G1 video)
      </p>
      <input
        type="file"
        name="plaza_video"
        accept="video/*"
        required
        className="block w-full text-sm mb-3 file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-[#3dd68c] file:text-black"
      />
      <button
        type="submit"
        disabled={loading}
        className="text-sm px-4 py-2 rounded-lg bg-[#3dd68c] text-black font-semibold disabled:opacity-50"
      >
        {loading ? "Uploading…" : "Attach G1 clip"}
      </button>
    </form>
  );
}
