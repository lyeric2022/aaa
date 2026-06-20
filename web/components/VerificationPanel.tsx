"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MoveCard } from "@/lib/types";

function Step({
  label,
  status,
  detail,
}: {
  label: string;
  status: "passed" | "pending" | "failed";
  detail: string;
}) {
  const styles = {
    passed: "border-[#3dd68c]/40 bg-[#3dd68c]/10 text-[#3dd68c]",
    pending: "border-[#f5a623]/40 bg-[#f5a623]/10 text-[#f5a623]",
    failed: "border-[#ff5c5c]/40 bg-[#ff5c5c]/10 text-[#ff5c5c]",
  };
  return (
    <div className={`rounded-xl border p-4 ${styles[status]}`}>
      <p className="text-xs uppercase tracking-[0.18em] opacity-80">{status}</p>
      <p className="font-semibold text-white mt-1">{label}</p>
      <p className="text-xs mt-1 opacity-80">{detail}</p>
    </div>
  );
}

export function VerificationPanel({ card }: { card: MoveCard }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const form = new FormData(e.currentTarget);
      const res = await fetch(`/api/moves/${card.id}/verification`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("verification upload failed");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const verificationStatus =
    card.verification?.status === "not_run"
      ? "pending"
      : (card.verification?.status ?? "pending");
  const plazaStatus = card.plaza_video_url ? "passed" : "pending";

  return (
    <div className="rounded-2xl border border-[#2a2a3d] bg-[#14141f] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#8888a0]">
            Robotics Verification
          </p>
          <h2 className="text-xl font-bold mt-1">Deploy ladder</h2>
        </div>
        <span className="rounded-full bg-[#7c5cff]/20 px-3 py-1 text-xs font-semibold text-[#a78bfa]">
          Data → Eval → Sim → Hardware
        </span>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Step
          label="Studio SONIC"
          status={card.studio_sonic_validated ? "passed" : "pending"}
          detail="Retargeted export in 29-DOF SONIC format"
        />
        <Step
          label="3D Replay"
          status="passed"
          detail="Browser preview from joint_pos.csv"
        />
        <Step
          label="MuJoCo / GEAR"
          status={verificationStatus}
          detail={card.verification?.notes || "Attach official replay video"}
        />
        <Step
          label="G1 Plaza"
          status={plazaStatus}
          detail={card.plaza_video_url ? "Hardware proof attached" : "Film Lower Sproul run"}
        />
      </div>

      {card.verification?.metrics && (
        <div className="mt-5 grid gap-3 rounded-xl border border-[#2a2a3d] bg-[#101018] p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[#8888a0]">
              Torso Tilt
            </p>
            <p className="mt-1 font-semibold text-white">
              {card.verification.metrics.torso_tilt_deg ?? "n/a"}°
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[#8888a0]">
              COM Drift
            </p>
            <p className="mt-1 font-semibold text-white">
              {card.verification.metrics.com_drift_m ?? "n/a"} m
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[#8888a0]">
              Fall Detected
            </p>
            <p className="mt-1 font-semibold text-white">
              {card.verification.metrics.fall_detected ? "yes" : "no"}
            </p>
          </div>
        </div>
      )}

      {card.verification?.video_url ? (
        <video
          src={card.verification.video_url}
          controls
          className="mt-5 w-full rounded-xl border border-[#3dd68c]/30"
        />
      ) : (
        <details className="mt-5 rounded-xl border border-dashed border-[#2a2a3d] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#a78bfa]">
            Optional: attach MuJoCo / Studio replay proof
          </summary>
          <form onSubmit={submit} className="mt-4">
            <div className="grid sm:grid-cols-[140px_1fr] gap-3">
              <select
                name="status"
                defaultValue="passed"
                className="rounded-lg border border-[#2a2a3d] bg-[#101018] px-3 py-2 text-sm"
              >
                <option value="passed">passed</option>
                <option value="failed">failed</option>
                <option value="pending">pending</option>
              </select>
              <input
                name="notes"
                placeholder="e.g. MuJoCo replay stable, no fall"
                className="rounded-lg border border-[#2a2a3d] bg-[#101018] px-3 py-2 text-sm"
              />
            </div>
            <input
              type="file"
              name="verification_video"
              accept="video/*"
              className="mt-3 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-[#7c5cff] file:px-3 file:py-2 file:text-white"
            />
            <button
              disabled={loading}
              className="mt-3 rounded-lg bg-[#7c5cff] px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save verification"}
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
