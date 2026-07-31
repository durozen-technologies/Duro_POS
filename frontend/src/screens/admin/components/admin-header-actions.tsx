import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAdminTranslation } from "@/hooks/use-admin-translation";

import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import { AdminLanguageToggle } from "./admin-language-toggle";

type AdminHeaderActionsProps = {
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  refreshDisabled?: boolean;
};

export function AdminHeaderActions({
  onRefresh,
  refreshing = false,
  refreshDisabled = false,
}: AdminHeaderActionsProps) {
  const { colorScheme, palette, setThemePreference } = useAdminTheme();
  const { t } = useAdminTranslation();
  const nextTheme = colorScheme === "dark" ? "light" : "dark";
  const themeIcon = colorScheme === "dark" ? "white-balance-sunny" : "weather-night";
  const refreshUnavailable = !onRefresh || refreshDisabled || refreshing;

  return (
    <View style={styles.actions}>
      <AdminLanguageToggle palette={palette} compact />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("a11y.refresh")}
        accessibilityState={{ disabled: refreshUnavailable }}
        disabled={refreshUnavailable}
        onPress={() => {
          triggerHaptic();
          void onRefresh?.();
        }}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: palette.shellControl,
            borderColor: palette.shellBorder,
            opacity: refreshUnavailable ? 0.62 : pressed ? 0.78 : 1,
          },
        ]}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={palette.onShell} />
        ) : (
          <MaterialCommunityIcons name="refresh" size={19} color={palette.onShell} />
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nextTheme === "light" ? t("a11y.switchToLight") : t("a11y.switchToDark")}
        onPress={() => {
          triggerHaptic();
          setThemePreference(nextTheme);
        }}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: palette.shellControl,
            borderColor: palette.shellBorder,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        <MaterialCommunityIcons name={themeIcon} size={19} color={palette.onShell} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
