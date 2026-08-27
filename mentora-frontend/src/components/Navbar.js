import Link from "next/link";

export default function Navbar() {
  return (
    <header className="border-b border-white/10 bg-navy-900/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent font-bold text-lg group-hover:bg-accent/25 transition-colors">
            M
          </span>
          <span className="text-xl font-extrabold tracking-tight text-white">
            Mentora
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-navy-100/80">
          <Link href="/upload" className="hover:text-white transition-colors">
            Upload
          </Link>
          <Link href="/profile" className="hover:text-white transition-colors">
            Profile
          </Link>
          <Link href="/matches" className="hover:text-white transition-colors">
            Matches
          </Link>
        </nav>
      </div>
    </header>
  );
}
