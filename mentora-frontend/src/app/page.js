import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center py-24">
          <div className="inline-flex items-center gap-2 mb-8">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent font-bold text-3xl">
              M
            </span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-6">
            Mentora
          </h1>
          <p className="text-lg sm:text-xl text-navy-100/70 mb-12 leading-relaxed">
            Find your perfect mentor, automatically.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center justify-center rounded-xl bg-accent px-8 py-4 text-base font-semibold text-navy-900 shadow-soft hover:bg-accent-light transition-colors"
          >
            Get Matched
          </Link>
          <p className="mt-6 text-sm text-navy-100/40">
            Upload your pitch deck. We handle the rest.
          </p>
        </div>
      </main>
    </>
  );
}
