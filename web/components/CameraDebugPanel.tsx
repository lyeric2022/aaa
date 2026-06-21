"use client";

import { useState } from "react";
import {
  formatCameraFrame,
  type CameraFrame,
} from "@/lib/cameraFrame";

function VecRow({ label, vec }: { label: string; vec: CameraFrame["position"] }) {
  return (
    <div className="grid grid-cols-[52px_1fr_1fr_1fr] gap-1 font-mono text-[10px] text-[#d6d6e4]">
      <span className="text-[#8888a0]">{label}</span>
      <span>x {vec.x.toFixed(3)}</span>
      <span>y {vec.y.toFixed(3)}</span>
      <span>z {vec.z.toFixed(3)}</span>
    </div>
  );
}

export function CameraDebugPanel({
  label,
  frame,
  defaultFrame,
  onReset,
}: {
  label: string;
  frame: CameraFrame;
  defaultFrame: CameraFrame;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  async function copyFrame() {
    await navigator.clipboard.writeText(formatCameraFrame(frame));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="absolute right-4 top-4 z-20 w-[min(100%,280px)] rounded-lg border border-[#2a2a3d] bg-black/75 text-xs text-[#e8e8f0] shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-semibold text-[#a78bfa]">{label}</span>
        <span className="text-[#8888a0]">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[#2a2a3d] px-3 py-2">
          <p className="text-[10px] leading-relaxed text-[#8888a0]">
            Orbit the view, then copy this frame. Defaults are temporary until you
            send the hero shot.
          </p>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#8888a0]">
              Position
            </p>
            <VecRow label="cam" vec={frame.position} />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#8888a0]">
              Look at
            </p>
            <VecRow label="tgt" vec={frame.target} />
          </div>

          <div className="space-y-1 border-t border-[#2a2a3d] pt-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#8888a0]">
              Default (temp)
            </p>
            <VecRow label="cam" vec={defaultFrame.position} />
            <VecRow label="tgt" vec={defaultFrame.target} />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={copyFrame}
              className="flex-1 rounded border border-[#7c5cff]/40 bg-[#7c5cff]/15 px-2 py-1.5 font-medium text-[#c4b5fd]"
            >
              {copied ? "Copied" : "Copy frame"}
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-[#2a2a3d] px-2 py-1.5 text-[#8888a0] hover:border-[#8888a0]"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
