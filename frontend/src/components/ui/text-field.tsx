import { type ComponentProps } from "react";
import { TextInput, View } from "react-native";

import { cn } from "@/utils/cn";
import { ShopText as Text } from "@/components/ui/shop-text";

type TextFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  suffix?: string;
  className?: string;
  containerClassName?: string;
};

export function TextField({ label, error, suffix, className, containerClassName, ...props }: TextFieldProps) {
  return (
    <View className="gap-2">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</Text>
      <View
        className={cn(
          "min-h-12 flex-row items-center rounded-control border px-4 border-border bg-surface",
          error && "border-danger",
          containerClassName,
        )}
      >
        <TextInput
          className={cn("flex-1 text-base text-ink", className)}
          placeholderTextColor="#4B6356"
          {...props}
        />
        {suffix ? <Text className="text-xs font-semibold text-muted">{suffix}</Text> : null}
      </View>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
    </View>
  );
}
