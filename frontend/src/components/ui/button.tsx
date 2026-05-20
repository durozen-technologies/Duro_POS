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
    primary: "border border-accent bg-accent shadow-pos",
    secondary: "border border-border bg-card shadow-soft",
    danger: "border border-[#9F4335] bg-[#9F4335] shadow-soft",
  }[variant];

  const textColor = variant === "secondary" ? "text-ink" : "text-white";
  const sizeStyles = size === "sm" ? "min-h-11 rounded-[18px] px-4" : "min-h-[58px] rounded-[24px] px-5";
  const textSize = size === "sm" ? "text-sm" : "text-[15px]";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={cn(
        "items-center justify-center",
        palette,
        sizeStyles,
        disabled && !loading && "opacity-75",
        className,
      )}
    >
      <View className="w-full items-center justify-center">
        {loading ? (
          <ActivityIndicator color={variant === "secondary" ? "#1E2B22" : "#FFFFFF"} />
        ) : (
          <Text className={cn("text-center font-semibold tracking-[0.3px]", textColor, textSize, textClassName)}>{label}</Text>
        )}
      </View>
    </Pressable>
  );
});
