import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Navbar from "@/components/layout/Navbar";
import PageTransition from "@/components/PageTransition";

// Self-hosted by next/font; exposed as --font-inter, which globals.css maps
// onto Tailwind's --font-sans.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

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
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <div className="min-h-screen flex flex-col">
          {/* The navbar lives outside the transition so it stays put while
              page content animates between routes. It hides itself on routes
              that bring their own chrome. */}
          <Navbar />
          <PageTransition>{children}</PageTransition>
        </div>
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}
