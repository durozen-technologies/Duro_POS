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
  emerald: string;
  emeraldDark: string;
  emeraldSoft: string;
  gold: string;
  goldSoft: string;
  success: string;
  successSoft: string;
  cash: string;
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
  background: "#0E141A",
  backgroundElevated: "#141C24",
  surfaceMuted: "#17212B",
  card: "#1B2631",
  glass: "rgba(255,255,255,0.05)",
  glassBorder: "rgba(255,255,255,0.1)",
  textPrimary: "#F4F7FA",
  textSecondary: "#CDD7E1",
  textMuted: "#90A0B3",
  border: "rgba(144,160,179,0.16)",
  emerald: "#157A62",
  emeraldDark: "#D3F4EA",
  emeraldSoft: "rgba(21,122,98,0.18)",
  gold: "#C98A2E",
  goldSoft: "rgba(201,138,46,0.16)",
  success: "#2BAE66",
  successSoft: "rgba(43,174,102,0.16)",
  cash: "#D89A37",
  cashSoft: "rgba(216,154,55,0.16)",
  upi: "#5B8DEF",
  upiSoft: "rgba(91,141,239,0.16)",
  danger: "#E15B64",
  dangerSoft: "rgba(225,91,100,0.16)",
  shadow: "#000000",
  overlay: "rgba(7,10,14,0.6)",
  navBackdrop: "rgba(14,20,26,0.96)",
};

const LIGHT_ADMIN_PALETTE: ThemePalette = {
  background: "#F4F6F3",
  backgroundElevated: "#EEF2EC",
  surfaceMuted: "#F8FBF7",
  card: "#FFFFFF",
  glass: "rgba(21,122,98,0.05)",
  glassBorder: "rgba(21,122,98,0.1)",
  textPrimary: "#18212B",
  textSecondary: "#4E5E70",
  textMuted: "#718193",
  border: "#DCE4DB",
  emerald: "#157A62",
  emeraldDark: "#0F5A49",
  emeraldSoft: "#DCEFE8",
  gold: "#C98A2E",
  goldSoft: "#F8ECD5",
  success: "#23874E",
  successSoft: "#DFF3E7",
  cash: "#D89A37",
  cashSoft: "#FAEFD8",
  upi: "#3D74D8",
  upiSoft: "#DFE9FB",
  danger: "#D14B5A",
  dangerSoft: "#FBE3E6",
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
