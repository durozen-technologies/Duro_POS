import { type ComponentProps } from "react";
import { Text, TextInput, View } from "react-native";

import { cn } from "@/utils/cn";

type TextFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  suffix?: string;
  className?: string;
};

export function TextField({ label, error, suffix, className, ...props }: TextFieldProps) {
  return (
    <View className="gap-2">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</Text>
      <View
        className={cn(
          "min-h-12 flex-row items-center rounded-control border px-4 border-border bg-surface",
          error && "border-danger",
        )}
      >
        <TextInput
          className={cn("flex-1 text-base text-ink", className)}
          placeholderTextColor="#64748B"
          {...props}
        />
        {suffix ? <Text className="text-xs font-semibold text-muted">{suffix}</Text> : null}
      </View>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
    </View>
  );
}
