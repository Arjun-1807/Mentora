/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef1f8",
          100: "#d7ddef",
          200: "#aab4d9",
          300: "#7c8bc2",
          400: "#4f60ab",
          500: "#2c3a80",
          600: "#1b2559",
          700: "#131c44",
          800: "#0b1330",
          900: "#0a1128",
          950: "#060a1a",
        },
        accent: {
          DEFAULT: "#4fd1c5",
          light: "#7fe3d9",
          dark: "#38a89d",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 10px 30px -12px rgba(10, 17, 40, 0.25)",
        soft: "0 4px 14px -4px rgba(10, 17, 40, 0.15)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
