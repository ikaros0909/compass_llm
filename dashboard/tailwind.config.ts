import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 표면 계층 (어두운 → 밝은)
        bg: "#080b12",
        surface: "#0e131d",
        panel: "#131926",
        elevated: "#1a2130",
        border: "#222c3d",
        borderlight: "#2c3850",
        // 텍스트
        muted: "#8a97ad",
        faint: "#5a6678",
        // 강조/상태
        accent: "#6366f1",
        "accent-2": "#818cf8",
        success: "#22c55e",
        danger: "#f43f5e",
        warn: "#f59e0b",
        info: "#38bdf8",
      },
      borderRadius: { xl: "0.85rem", "2xl": "1.1rem" },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.3), 0 8px 24px -12px rgba(0,0,0,0.5)",
        glow: "0 0 0 1px rgba(99,102,241,0.4), 0 8px 30px -8px rgba(99,102,241,0.45)",
      },
      fontFamily: {
        sans: ["Inter", "Pretendard", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        pulse2: "pulse2 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
