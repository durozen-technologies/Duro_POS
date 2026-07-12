import { View } from "react-native";

import { useShopTranslation } from "@/hooks/use-shop-translation";
import { cn } from "@/utils/cn";
import { ShopText as Text } from "@/components/ui/shop-text";

type StatusPillProps = {
  label: string;
  tone?: "success" | "warning" | "danger" | "neutral";
};

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const { isTamil } = useShopTranslation();
  const toneStyles = {
    success: {
      container: "border-green-200 bg-successSoft",
      text: "text-green-900",
      dot: "bg-green-700",
    },
    warning: {
      container: "border-amber-200 bg-warningSoft",
      text: "text-amber-900",
      dot: "bg-amber-700",
    },
    danger: {
      container: "border-red-200 bg-dangerSoft",
      text: "text-red-900",
      dot: "bg-red-700",
    },
    neutral: {
      container: "border-border bg-surface",
      text: "text-accentDeep",
      dot: "bg-accent",
    },
  }[tone];

  return (
    <View className={cn("self-start flex-row items-center gap-2 rounded-full border px-3 py-1.5", toneStyles.container)}>
      <View className={cn("h-2 w-2 rounded-full", toneStyles.dot)} />
      <Text
        className={cn(
          "font-semibold",
          isTamil ? "text-xs leading-5 tracking-[0px]" : "text-[11px] uppercase tracking-[1.2px]",
          toneStyles.text,
        )}
      >
        {label}
      </Text>
    </View>
  );
}
