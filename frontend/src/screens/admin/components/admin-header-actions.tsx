import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";

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
  const nextTheme = colorScheme === "dark" ? "light" : "dark";
  const themeIcon = colorScheme === "dark" ? "white-balance-sunny" : "weather-night";
  const refreshUnavailable = !onRefresh || refreshDisabled || refreshing;

  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        accessibilityState={{ disabled: refreshUnavailable }}
        disabled={refreshUnavailable}
        onPress={() => {
          triggerHaptic();
          void onRefresh?.();
        }}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: palette.surfaceMuted,
            borderColor: palette.border,
            opacity: refreshUnavailable ? 0.62 : pressed ? 0.78 : 1,
          },
        ]}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={palette.primary} />
        ) : (
          <MaterialCommunityIcons name="refresh" size={19} color={palette.textPrimary} />
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${nextTheme} mode`}
        onPress={() => {
          triggerHaptic();
          setThemePreference(nextTheme);
        }}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: palette.surfaceMuted,
            borderColor: palette.border,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        <MaterialCommunityIcons name={themeIcon} size={19} color={palette.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 40,
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
