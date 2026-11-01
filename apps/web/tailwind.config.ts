import type { Config } from "tailwindcss";
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "../../packages/{ui,pdf-viewer}/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // THYNKPDF red (from the logo). 600 = primary bg under white text (4.62:1); 700 = accent text on light
        // surfaces (5.92:1 on white); 300/400 = accent text on dark (#0B0B0C: 7.0:1 / 6.0:1). 500 = rings/outlines.
        brand: { 50: "#FFF1F1", 100: "#FFE0E0", 300: "#FF7A7C", 400: "#FF4D4F", 500: "#FF2A2A", 600: "#E8141C", 700: "#C8101A", 800: "#A00D15" },
        ink: "#0B0B0C",
        paper: "#FAFAF9",
      },
    },
  },
} satisfies Config;
