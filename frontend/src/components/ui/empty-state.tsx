import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShopText as Text } from "@/components/ui/shop-text";

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Card className="items-center gap-4 border-dashed py-8">
      <MaterialCommunityIcons name="clipboard-text-outline" size={28} color="#4B6356" />
      <View className="items-center gap-2">
        <Text className="text-base font-semibold text-ink">{title}</Text>
        <Text className="max-w-[320px] text-center text-sm leading-5 text-muted">{description}</Text>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </Card>
  );
}
