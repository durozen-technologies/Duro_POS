export type ThemePalette = {
  background: string;
  backgroundElevated: string;
  surfaceMuted: string;
  card: string;
  glass: string;
  glassBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primaryStrong: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  analytics: string;
  analyticsStrong: string;
  analyticsSoft: string;
  items: string;
  itemsStrong: string;
  itemsSoft: string;
  inventory: string;
  inventoryStrong: string;
  inventorySoft: string;
  billing: string;
  billingStrong: string;
  billingSoft: string;
  gold: string;
  goldSoft: string;
  settings: string;
  settingsStrong: string;
  settingsSoft: string;
  success: string;
  successSoft: string;
  cash: string;
  onCash: string;
  cashSoft: string;
  upi: string;
  upiSoft: string;
  danger: string;
  dangerSoft: string;
  shadow: string;
  overlay: string;
  navBackdrop: string;
};

const DARK_ADMIN_PALETTE: ThemePalette = {
  background: "#171513",
  backgroundElevated: "#201D1A",
  surfaceMuted: "#28241F",
  card: "#211F1C",
  glass: "rgba(199,165,232,0.09)",
  glassBorder: "rgba(199,165,232,0.16)",
  textPrimary: "#F8F5F0",
  textSecondary: "#DED8CE",
  textMuted: "#A79F94",
  border: "rgba(222,216,206,0.16)",
  primaryStrong: "#F1E6FF",
  primary: "#C7A5E8",
  primarySoft: "rgba(199,165,232,0.16)",
  onPrimary: "#24152F",
  analytics: "#67E8F9",
  analyticsStrong: "#CFFAFE",
  analyticsSoft: "rgba(34,211,238,0.16)",
  items: "#C4B5FD",
  itemsStrong: "#EDE9FE",
  itemsSoft: "rgba(167,139,250,0.18)",
  inventory: "#5EEAD4",
  inventoryStrong: "#CCFBF1",
  inventorySoft: "rgba(45,212,191,0.16)",
  billing: "#FBBF24",
  billingStrong: "#FEF3C7",
  billingSoft: "rgba(251,191,36,0.16)",
  gold: "#FBBF24",
  goldSoft: "rgba(251,191,36,0.16)",
  settings: "#CBD5E1",
  settingsStrong: "#F8FAFC",
  settingsSoft: "rgba(148,163,184,0.14)",
  success: "#4ADE80",
  successSoft: "rgba(74,222,128,0.16)",
  cash: "#F59E0B",
  onCash: "#201505",
  cashSoft: "rgba(245,158,11,0.16)",
  upi: "#93C5FD",
  upiSoft: "rgba(147,197,253,0.16)",
  danger: "#F87171",
  dangerSoft: "rgba(248,113,113,0.16)",
  shadow: "#000000",
  overlay: "rgba(7,10,14,0.6)",
  navBackdrop: "rgba(23,21,19,0.96)",
};

const LIGHT_ADMIN_PALETTE: ThemePalette = {
  background: "#F6F3EE",
  backgroundElevated: "#ECE6DD",
  surfaceMuted: "#FBF8F3",
  card: "#FFFFFF",
  glass: "rgba(90,62,122,0.05)",
  glassBorder: "rgba(90,62,122,0.11)",
  textPrimary: "#1F2430",
  textSecondary: "#4F5B6D",
  textMuted: "#737B8C",
  border: "#DDD4C8",
  primaryStrong: "#3B294D",
  primary: "#5A3E7A",
  primarySoft: "#EFE7F6",
  onPrimary: "#FFFFFF",
  analytics: "#0E7490",
  analyticsStrong: "#155E75",
  analyticsSoft: "#DDF4FA",
  items: "#6D3DB7",
  itemsStrong: "#4C1D95",
  itemsSoft: "#EEE7FF",
  inventory: "#0F766E",
  inventoryStrong: "#115E59",
  inventorySoft: "#CCFBF1",
  billing: "#B45309",
  billingStrong: "#78350F",
  billingSoft: "#FFF2D2",
  gold: "#B45309",
  goldSoft: "#FFF2D2",
  settings: "#475569",
  settingsStrong: "#334155",
  settingsSoft: "#F1F5F9",
  success: "#147D52",
  successSoft: "#DCFCE7",
  cash: "#9A6700",
  onCash: "#FFFFFF",
  cashSoft: "#FAEFD8",
  upi: "#2563EB",
  upiSoft: "#DBEAFE",
  danger: "#B42318",
  dangerSoft: "#FEE4E2",
  shadow: "#0F172A",
  overlay: "rgba(15,23,42,0.32)",
  navBackdrop: "rgba(255,255,255,0.97)",
};

export function getAdminPalette(colorScheme: "light" | "dark" | null | undefined): ThemePalette {
  return colorScheme === "dark" ? DARK_ADMIN_PALETTE : LIGHT_ADMIN_PALETTE;
}

export function adminShadow(color: string, opacity: number, radius: number, offsetHeight: number) {
  return {
    shadowColor: color,
    shadowOpacity: opacity * 0.72,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: Math.max(2, offsetHeight / 3) },
    elevation: Math.max(2, Math.round(offsetHeight / 4)),
  };
}
