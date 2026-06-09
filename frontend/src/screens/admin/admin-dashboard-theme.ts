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
  shell: string;
  shellBorder: string;
  onShell: string;
  onShellMuted: string;
  shellControl: string;
};

const DARK_ADMIN_PALETTE: ThemePalette = {
  background: "#0E0E0E",
  backgroundElevated: "#181818",
  surfaceMuted: "#202020",
  card: "#151515",
  glass: "rgba(255,255,255,0.08)",
  glassBorder: "rgba(255,255,255,0.16)",
  textPrimary: "#FFFFFF",
  textSecondary: "#E6E6E6",
  textMuted: "#A7A7A7",
  border: "rgba(255,255,255,0.15)",
  primaryStrong: "#FFB3B8",
  primary: "#F43F46",
  primarySoft: "rgba(244,63,70,0.18)",
  onPrimary: "#1A0003",
  analytics: "#FFFFFF",
  analyticsStrong: "#FFFFFF",
  analyticsSoft: "rgba(255,255,255,0.12)",
  items: "#F43F46",
  itemsStrong: "#FFCDD1",
  itemsSoft: "rgba(244,63,70,0.18)",
  inventory: "#F6C90E",
  inventoryStrong: "#FFE985",
  inventorySoft: "rgba(246,201,14,0.18)",
  billing: "#F6C90E",
  billingStrong: "#FFE985",
  billingSoft: "rgba(246,201,14,0.18)",
  gold: "#F6C90E",
  goldSoft: "rgba(246,201,14,0.18)",
  settings: "#FFFFFF",
  settingsStrong: "#FFFFFF",
  settingsSoft: "rgba(255,255,255,0.12)",
  success: "#F6C90E",
  successSoft: "rgba(246,201,14,0.18)",
  cash: "#F6C90E",
  onCash: "#111111",
  cashSoft: "rgba(246,201,14,0.18)",
  upi: "#FFFFFF",
  upiSoft: "rgba(255,255,255,0.12)",
  danger: "#FF4D55",
  dangerSoft: "rgba(255,77,85,0.18)",
  shadow: "#000000",
  overlay: "rgba(0,0,0,0.72)",
  navBackdrop: "rgba(0,0,0,0.96)",
  shell: "#000000",
  shellBorder: "rgba(255,255,255,0.14)",
  onShell: "#FFFFFF",
  onShellMuted: "#CFCFCF",
  shellControl: "rgba(255,255,255,0.10)",
};

const LIGHT_ADMIN_PALETTE: ThemePalette = {
  background: "#F3F3F3",
  backgroundElevated: "#EDEDED",
  surfaceMuted: "#F8F8F8",
  card: "#FFFFFF",
  glass: "rgba(0,0,0,0.05)",
  glassBorder: "rgba(0,0,0,0.12)",
  textPrimary: "#111111",
  textSecondary: "#2E2E2E",
  textMuted: "#666666",
  border: "#D8D8D8",
  primaryStrong: "#8F000B",
  primary: "#C1121F",
  primarySoft: "#FFE5E8",
  onPrimary: "#FFFFFF",
  analytics: "#111111",
  analyticsStrong: "#000000",
  analyticsSoft: "#E9E9E9",
  items: "#C1121F",
  itemsStrong: "#8F000B",
  itemsSoft: "#FFE5E8",
  inventory: "#B38A00",
  inventoryStrong: "#6F5600",
  inventorySoft: "#FFF5BF",
  billing: "#B38A00",
  billingStrong: "#6F5600",
  billingSoft: "#FFF5BF",
  gold: "#B38A00",
  goldSoft: "#FFF5BF",
  settings: "#111111",
  settingsStrong: "#000000",
  settingsSoft: "#E9E9E9",
  success: "#B38A00",
  successSoft: "#FFF5BF",
  cash: "#B38A00",
  onCash: "#111111",
  cashSoft: "#FFF5BF",
  upi: "#111111",
  upiSoft: "#E9E9E9",
  danger: "#C1121F",
  dangerSoft: "#FFE5E8",
  shadow: "#000000",
  overlay: "rgba(0,0,0,0.38)",
  navBackdrop: "rgba(0,0,0,0.96)",
  shell: "#000000",
  shellBorder: "rgba(255,255,255,0.14)",
  onShell: "#FFFFFF",
  onShellMuted: "#D0D0D0",
  shellControl: "rgba(255,255,255,0.10)",
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
