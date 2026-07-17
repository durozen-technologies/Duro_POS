import type { TextStyle, ViewStyle } from "react-native";

export type ThemePalette = {
  background: string;
  backgroundElevated: string;
  surfaceMuted: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  shadow: string;
  overlay: string;
  navBackdrop: string;
  surface: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  shell: string;
  shellBorder: string;
  onShell: string;
  onShellMuted: string;
  shellControl: string;
  // ponytail: legacy aliases — out-of-scope admin screens still reference these
  glass: string;
  glassBorder: string;
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
  cash: string;
  onCash: string;
  cashSoft: string;
  upi: string;
  upiSoft: string;
};

export const adminSpacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export const adminRadii = {
  control: 8,
  card: 12,
  pill: 999,
  icon: 8,
} as const;

export const adminTypography = {
  caption: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } satisfies TextStyle,
  body: {
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 18,
  } satisfies TextStyle,
  bodyStrong: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  } satisfies TextStyle,
  section: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  } satisfies TextStyle,
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  } satisfies TextStyle,
  page: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  } satisfies TextStyle,
  pageTitle: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  } satisfies TextStyle,
  metric: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
    fontVariant: ["tabular-nums"],
  } satisfies TextStyle,
  money: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  } satisfies TextStyle,
  badge: {
    fontSize: 11,
    fontWeight: "600",
  } satisfies TextStyle,
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  } satisfies TextStyle,
} as const;

type SemanticCore = Pick<
  ThemePalette,
  | "background"
  | "backgroundElevated"
  | "surfaceMuted"
  | "card"
  | "textPrimary"
  | "textSecondary"
  | "textMuted"
  | "border"
  | "primary"
  | "primaryStrong"
  | "primarySoft"
  | "onPrimary"
  | "success"
  | "successSoft"
  | "danger"
  | "dangerSoft"
  | "warning"
  | "warningSoft"
  | "shadow"
  | "overlay"
  | "navBackdrop"
  | "surface"
  | "accent"
  | "accentSoft"
  | "onAccent"
  | "shell"
  | "shellBorder"
  | "onShell"
  | "onShellMuted"
  | "shellControl"
>;

function withLegacyAliases(core: SemanticCore): ThemePalette {
  return {
    ...core,
    glass: core.surfaceMuted,
    glassBorder: core.border,
    analytics: core.textPrimary,
    analyticsStrong: core.textPrimary,
    analyticsSoft: core.surfaceMuted,
    items: core.success,
    itemsStrong: core.success,
    itemsSoft: core.successSoft,
    inventory: core.success,
    inventoryStrong: core.success,
    inventorySoft: core.successSoft,
    billing: core.success,
    billingStrong: core.success,
    billingSoft: core.successSoft,
    gold: core.warning,
    goldSoft: core.warningSoft,
    settings: core.textPrimary,
    settingsStrong: core.textPrimary,
    settingsSoft: core.surfaceMuted,
    cash: core.warning,
    onCash: core.textPrimary,
    cashSoft: core.warningSoft,
    upi: core.primary,
    upiSoft: core.primarySoft,
  };
}

// Primary: enterprise teal — oklch(0.44 0.115 188)
// ponytail: teal hue 188 chosen for precision-POS register; avoids AI-blue indigo default.
//           Neutral chroma tinted 0.007 toward hue 188 for palette cohesion.
const LIGHT_CORE: SemanticCore = {
  background: "#EEF4F5",          // oklch(0.95 0.007 188) — barely-tinted neutral
  backgroundElevated: "#E1EBEC",  // oklch(0.91 0.009 188)
  surfaceMuted: "#E1EBEC",
  card: "#FFFFFF",
  textPrimary: "#0A0F0F",
  textSecondary: "#1F3538",        // tinted toward brand hue for cohesion
  textMuted: "#4E6A6D",
  border: "#BAD0D3",
  primary: "#0B6E78",              // oklch(0.44 0.115 188) — deep teal, enterprise-grade
  primaryStrong: "#085762",        // darker for pressed/strong states
  primarySoft: "#D2EDEF",          // oklch(0.92 0.03 188) — gentle teal wash
  onPrimary: "#FFFFFF",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  warning: "#D97706",
  warningSoft: "#FEF3C7",
  shadow: "#0A1F22",
  overlay: "rgba(10,31,34,0.38)",
  navBackdrop: "rgba(255,255,255,0.96)",
  surface: "#FFFFFF",
  accent: "#0B6E78",
  accentSoft: "#D2EDEF",
  onAccent: "#FFFFFF",
  shell: "#FFFFFF",
  shellBorder: "#BAD0D3",
  onShell: "#0A0F0F",
  onShellMuted: "#4E6A6D",
  shellControl: "#EEF4F5",
};

const DARK_CORE: SemanticCore = {
  background: "#091518",           // oklch(0.12 0.018 188) — brand-tinted near-black
  backgroundElevated: "#102328",   // oklch(0.16 0.02 188)
  surfaceMuted: "#1A3539",         // oklch(0.24 0.025 188)
  card: "#102328",
  textPrimary: "#ECF4F5",
  textSecondary: "#9DC4C8",        // tinted toward brand hue
  textMuted: "#5E888C",
  border: "#255058",
  primary: "#2BBAC8",              // oklch(0.68 0.13 188) — vibrant teal for dark surfaces
  primaryStrong: "#56CDD8",        // lighter, for labels/strong states
  primarySoft: "rgba(43,186,200,0.18)",
  onPrimary: "#04191C",            // near-black on teal for max contrast
  success: "#22C55E",
  successSoft: "rgba(34,197,94,0.16)",
  danger: "#EF4444",
  dangerSoft: "rgba(239,68,68,0.16)",
  warning: "#F59E0B",
  warningSoft: "rgba(245,158,11,0.16)",
  shadow: "#000000",
  overlay: "rgba(0,0,0,0.72)",
  navBackdrop: "rgba(9,21,24,0.96)",
  surface: "#102328",
  accent: "#2BBAC8",
  accentSoft: "rgba(43,186,200,0.18)",
  onAccent: "#04191C",
  shell: "#102328",
  shellBorder: "#255058",
  onShell: "#ECF4F5",
  onShellMuted: "#5E888C",
  shellControl: "#1A3539",
};

const LIGHT_ADMIN_PALETTE = withLegacyAliases(LIGHT_CORE);
const DARK_ADMIN_PALETTE = withLegacyAliases(DARK_CORE);

export function getAdminPalette(colorScheme: "light" | "dark" | null | undefined): ThemePalette {
  return colorScheme === "dark" ? DARK_ADMIN_PALETTE : LIGHT_ADMIN_PALETTE;
}

/** Floating surfaces only — no border pairing. Max blur 8. */
export function adminElevation(level: 1 | 2 | 3 = 1): ViewStyle {
  const specs = {
    1: { opacity: 0.08, radius: 4, offset: 2, elevation: 2 },
    2: { opacity: 0.12, radius: 6, offset: 3, elevation: 4 },
    3: { opacity: 0.16, radius: 8, offset: 4, elevation: 6 },
  } as const;
  const spec = specs[level];
  return {
    shadowColor: "#000000",
    shadowOpacity: spec.opacity,
    shadowRadius: spec.radius,
    shadowOffset: { width: 0, height: spec.offset },
    elevation: spec.elevation,
  };
}

/** @deprecated Prefer adminElevation for floats; bordered surfaces use border only. */
export function adminShadow(color: string, opacity: number, radius: number, offsetHeight: number) {
  return {
    shadowColor: color,
    shadowOpacity: opacity * 0.72,
    shadowRadius: Math.min(radius, 8),
    shadowOffset: { width: 0, height: Math.max(2, offsetHeight / 3) },
    elevation: Math.max(2, Math.round(offsetHeight / 4)),
  };
}

export const adminPressScale = 0.98;
export const adminPressOpacity = 0.92;
export const adminPressDurationMs = 120;

/** Apply to all money, counts, IDs, and dates in tables/lists. */
export const adminTabularNums: TextStyle = {
  fontVariant: ["tabular-nums"],
};