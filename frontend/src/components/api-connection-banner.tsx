import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, Text, View } from "react-native";

import { API_CONNECTION_ERROR_MESSAGE } from "@/api/client";
import { useApiConnection } from "@/hooks/use-api-connection";

type ApiConnectionBannerProps = {
  variant?: "nativewind" | "styled";
  palette?: {
    danger: string;
    dangerSoft: string;
  };
};

export function ApiConnectionBanner({
  variant = "nativewind",
  palette,
}: ApiConnectionBannerProps) {
  const apiConnection = useApiConnection();

  if (apiConnection.status !== "offline") {
    return null;
  }

  const retryLabel = apiConnection.checking ? "Checking" : "Retry";
  const onRetry = () => void apiConnection.retry();

  if (variant === "styled" && palette) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: palette.danger,
          backgroundColor: palette.dangerSoft,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <MaterialCommunityIcons name="cloud-off-outline" size={18} color={palette.danger} />
        <Text
          style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600", color: palette.danger }}
        >
          {API_CONNECTION_ERROR_MESSAGE}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry server connection"
          disabled={apiConnection.checking}
          hitSlop={10}
          onPress={onRetry}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: palette.danger }}>{retryLabel}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 rounded-card border border-[#B42318] bg-[#FEE4E2] px-4 py-3">
      <MaterialCommunityIcons name="cloud-off-outline" size={18} color="#B42318" />
      <Text className="min-w-0 flex-1 text-sm font-semibold text-[#B42318]">
        {API_CONNECTION_ERROR_MESSAGE}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry server connection"
        disabled={apiConnection.checking}
        hitSlop={10}
        onPress={onRetry}
      >
        <Text className="text-xs font-extrabold text-[#B42318]">{retryLabel}</Text>
      </Pressable>
    </View>
  );
}
