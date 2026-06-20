import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/ingest", label: "Ingest" },
  { href: "/fighters/build", label: "Fighters" },
  { href: "/arena", label: "Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Nav() {
  return (
    <nav className="border-b border-[#2a2a3d] bg-[#0a0a0f]/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="font-bold tracking-widest text-sm uppercase text-[#7c5cff]">
          Ghost Fighter
        </Link>
        <div className="flex flex-wrap gap-1 sm:gap-3">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs sm:text-sm px-2 py-1 rounded text-[#8888a0] hover:text-white hover:bg-[#14141f] transition"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
