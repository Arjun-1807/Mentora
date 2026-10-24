"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light / dark theming via a `.dark` class on <html>. Dark is the default
 * (the product was designed dark-first); the choice persists in localStorage.
 */
export default function ThemeProvider({ children }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
