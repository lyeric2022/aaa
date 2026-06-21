function StatInfo({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex ml-1.5 align-middle">
      <button
        type="button"
        aria-label="More info"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#8888a0]/40 text-[10px] font-semibold leading-none text-[#8888a0] transition hover:border-[#a78bfa] hover:text-[#a78bfa]"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-[#2a2a3d] bg-[#101018] px-3 py-2 text-left text-[11px] leading-snug text-[#c8c8d4] opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function StatBar({
  label,
  value,
  risk,
  info,
}: {
  label: string;
  value: number;
  risk?: boolean;
  info?: string;
}) {
  const v = Math.round(value);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-[#8888a0] mb-1">
        <span className="inline-flex items-center">
          {label}
          {info ? <StatInfo text={info} /> : null}
        </span>
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
