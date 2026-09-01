import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center bg-primary text-primary-foreground font-bold text-lg">
            M
          </span>
          <span className="text-xl font-bold tracking-tight text-foreground">
            Mentora
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/upload" className="hover:text-foreground transition-colors">
            Upload
          </Link>
          <Link href="/profile" className="hover:text-foreground transition-colors">
            Profile
          </Link>
          <Link href="/matches" className="hover:text-foreground transition-colors">
            Matches
          </Link>
          <Link href="/dashboard" className="hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <Button size="sm" render={<Link href="/login" />}>
            Sign In
          </Button>
        </nav>
      </div>
    </header>
  );
}
