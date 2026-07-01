import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable } from "react-native";

const MUTED = "#4B6356";

type SuperAdminRefreshButtonProps = {
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  disabled?: boolean;
};

export function SuperAdminRefreshButton({
  onRefresh,
  refreshing = false,
  disabled = false,
}: SuperAdminRefreshButtonProps) {
  const unavailable = disabled || refreshing;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh"
      accessibilityState={{ disabled: unavailable, busy: refreshing }}
      className={`min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card ${unavailable ? "opacity-50" : "active:opacity-80"}`}
      disabled={unavailable}
      onPress={() => void onRefresh()}
    >
      {refreshing ? (
        <ActivityIndicator size="small" color={MUTED} />
      ) : (
        <MaterialCommunityIcons name="refresh" size={20} color={MUTED} />
      )}
    </Pressable>
  );
}

export const SUPER_ADMIN_REFRESH_TINT = "#0F7642";
