/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./App.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#F1F5F9",
        ink: "#0B0B0B",
        accent: "#4F46E5",
        accentDeep: "#4338CA",
        accentSoft: "#E0E7FF",
        success: "#16A34A",
        successSoft: "#DCFCE7",
        warning: "#D97706",
        warningSoft: "#FEF3C7",
        danger: "#DC2626",
        dangerSoft: "#FEE2E2",
        card: "#FFFFFF",
        muted: "#64748B",
        border: "#CBD5E1",
        surface: "#E2E8F0",
      },
      borderRadius: {
        control: "8px",
        card: "12px",
      },
      boxShadow: {
        float: "0 4px 8px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};
