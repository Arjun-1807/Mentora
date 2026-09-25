import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";
import PageTransition from "@/components/PageTransition";

// next/font/google's Geist entry isn't available on this Next.js version's
// font dataset, so we use Vercel's official `geist` package instead — same
// font, same self-hosting/optimization benefits.
const geistSans = GeistSans;

export const metadata = {
  title: {
    default: "Mentora — find the right mentor, automatically",
    template: "%s · Mentora",
  },
  description:
    "Mentora uses AI to match startups with domain-expert mentors — from pitch deck to personalised intro, in seconds.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <div className="min-h-screen flex flex-col">
          {/* The navbar lives outside the transition so it stays put while
              page content animates between routes. */}
          <Navbar />
          <PageTransition>{children}</PageTransition>
        </div>
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}
