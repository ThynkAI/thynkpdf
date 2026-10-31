import type { Config } from "tailwindcss";
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "../../packages/{ui,pdf-viewer}/src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: { 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca" } } } },
} satisfies Config;
