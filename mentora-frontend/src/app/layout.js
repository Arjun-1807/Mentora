import "./globals.css";

export const metadata = {
  title: "Mentora",
  description:
    "Mentora matches early-stage startups with the mentors best suited to help them grow — automatically, from a single pitch deck.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-navy-900 text-white antialiased font-sans">
        <div className="min-h-screen flex flex-col">{children}</div>
      </body>
    </html>
  );
}
