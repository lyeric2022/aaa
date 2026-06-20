export function StatBar({
  label,
  value,
  risk,
}: {
  label: string;
  value: number;
  risk?: boolean;
}) {
  const v = Math.round(value);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-[#8888a0] mb-1">
        <span>{label}</span>
        <span>{v}</span>
      </div>
      <div className="h-2 bg-[#2a2a3d] rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${
            risk
              ? "bg-gradient-to-r from-[#f5a623] to-[#ff5c5c]"
              : "bg-gradient-to-r from-[#7c5cff] to-[#a78bfa]"
          }`}
          style={{ width: `${Math.min(100, v)}%` }}
        />
      </div>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    safe: "bg-[#3dd68c]/15 text-[#3dd68c]",
    needs_edits: "bg-[#f5a623]/15 text-[#f5a623]",
    unsafe: "bg-[#ff5c5c]/15 text-[#ff5c5c]",
    pending: "bg-[#8888a0]/15 text-[#8888a0]",
  };
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${styles[verdict] ?? styles.pending}`}
    >
      {verdict.replace("_", " ")}
    </span>
  );
}
