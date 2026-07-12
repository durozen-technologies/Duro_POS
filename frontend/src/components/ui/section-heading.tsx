import { View } from "react-native";

import { cn } from "@/utils/cn";
import { ShopText as Text } from "@/components/ui/shop-text";

type SectionHeadingProps = {
  title: string;
  subtitle?: string;
};

export function SectionHeading({ title, subtitle }: SectionHeadingProps) {
  return (
    <View className="gap-1">
      <Text className="text-lg font-bold text-ink">{title}</Text>
      {subtitle ? (
        <Text className="max-w-[640px] text-sm leading-5 text-muted">{subtitle}</Text>
      ) : null}
    </View>
  );
}
