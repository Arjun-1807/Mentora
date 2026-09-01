import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// next/font/google's Geist entry isn't available on this Next.js version's
// font dataset, so we use Vercel's official `geist` package instead — same
// font, same self-hosting/optimization benefits.
const geistSans = GeistSans;

export const metadata = {
  title: "Mentora",
  description:
    "Mentora matches early-stage startups with the mentors best suited to help them grow — automatically, from a single pitch deck.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <div className="min-h-screen flex flex-col">{children}</div>
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}
