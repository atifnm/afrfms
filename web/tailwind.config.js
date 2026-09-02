/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // PAA brand, sampled from the authority's logo.
        brand: {
          DEFAULT: "#00401A",
          deep: "#00230D",
          gold: "#CAA202",
          "gold-light": "#F3E6B3",
        },
        // App surfaces — a warm, calm off-white rather than clinical pure white.
        surface: {
          DEFAULT: "#F6F7F5",
          card: "#FFFFFF",
          hairline: "#E1E4DF",
        },
        ink: {
          primary: "#14181A",
          secondary: "#5C6B63",
          faint: "#8B968F",
        },
        // Status semantics — deliberately distinct from brand.gold so
        // "in progress" is never confused with a brand accent.
        status: {
          active: "#1E8A4C",
          progress: "#C2661A",
          critical: "#C1272D",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
