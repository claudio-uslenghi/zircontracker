import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Wires up the brand tokens already defined in globals.css (same
        // hex values as the inline styles scattered through the app) so
        // new code can use text-primary/bg-primary instead of magic hex.
        primary: "var(--zircon-blue)",
        "primary-dark": "var(--zircon-blue-dark)",
        "primary-light": "var(--zircon-blue-light)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
