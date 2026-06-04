import { useMemo } from "react";
import { useColorScheme } from "react-native";

import { useAdminThemeStore } from "@/store/admin-theme-store";

import { getAdminPalette } from "./admin-dashboard-theme";

export function useAdminTheme() {
  const systemColorScheme = useColorScheme();
  const themePreference = useAdminThemeStore((state) => state.themePreference);
  const setThemePreference = useAdminThemeStore((state) => state.setThemePreference);
  const colorScheme = themePreference === "system" ? systemColorScheme ?? "light" : themePreference;
  const palette = useMemo(() => getAdminPalette(colorScheme), [colorScheme]);

  return {
    colorScheme,
    palette,
    setThemePreference,
    themePreference,
  };
}
