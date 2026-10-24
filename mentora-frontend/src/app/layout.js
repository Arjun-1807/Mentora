import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Navbar from "@/components/layout/Navbar";
import Backdrop from "@/components/layout/Backdrop";
import PageTransition from "@/components/PageTransition";
import ThemeProvider from "@/components/theme/ThemeProvider";

// Editorial serif, used only for italic accent words in display headings.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-instrument-serif",
});

export const metadata = {
  title: {
    default: "Mentora — find the right mentor, automatically",
    template: "%s · Mentora",
  },
  description:
    "Mentora uses AI to match startups with domain-expert mentors — from pitch deck to personalised intro, in seconds.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f1a" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ThemeProvider>
          <Backdrop />
          <div className="relative min-h-screen flex flex-col">
            {/* The navbar lives outside the transition so it stays put while
                page content animates between routes. It hides itself on
                routes that bring their own chrome. */}
            <Navbar />
            <PageTransition>{children}</PageTransition>
          </div>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
