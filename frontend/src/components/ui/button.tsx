import * as Haptics from "expo-haptics";
import { memo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { cn } from "@/utils/cn";

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "sm";
  className?: string;
  textClassName?: string;
};

export const Button = memo(function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  className,
  textClassName,
}: ButtonProps) {
  const palette = {
    primary: "bg-accent border-accent",
    secondary: "bg-card border-border",
    danger: "border-danger bg-danger",
  }[variant];

  const textColor = variant === "secondary" ? "text-ink" : "text-white";
  const sizeStyles = size === "sm" ? "min-h-10 rounded-control px-4" : "min-h-12 rounded-control px-5";
  const textSize = size === "sm" ? "text-sm" : "text-[15px]";
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={() => {
        if (blocked) {
          return;
        }
        if (variant === "primary") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        }
        onPress();
      }}
      disabled={blocked}
      className={cn("items-center justify-center border", palette, sizeStyles, className)}
      style={({ pressed }) => ({
        opacity: blocked ? 0.55 : pressed ? 0.92 : 1,
        transform: [{ scale: pressed && !blocked ? 0.98 : 1 }],
      })}
    >
      <View className="w-full items-center justify-center">
        {loading ? (
          <ActivityIndicator color={variant === "secondary" ? "#0B0B0B" : "#FFFFFF"} />
        ) : (
          <Text className={cn("text-center font-semibold", textColor, textSize, textClassName)}>{label}</Text>
        )}
      </View>
    </Pressable>
  );
});
