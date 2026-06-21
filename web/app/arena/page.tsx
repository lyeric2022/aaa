import { Suspense } from "react";
import { Arena3D } from "@/components/Arena3D";

export default function ArenaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[#8888a0]">Loading arena…</div>}>
      <Arena3D />
    </Suspense>
  );
}
