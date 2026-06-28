import { ActivityIndicator, Text, View } from "react-native";

type LoadingStateProps = {
  label?: string;
  fullscreen?: boolean;
};

export function LoadingState({ label = "Loading...", fullscreen = false }: LoadingStateProps) {
  return (
    <View className={fullscreen ? "flex-1 items-center justify-center gap-3 px-6" : "items-center justify-center gap-3 py-10"}>
      <ActivityIndicator color="#4F46E5" size="large" />
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}
