import { memo, ReactNode } from "react";
import { View } from "react-native";

import { cn } from "@/utils/cn";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export const Card = memo(function Card({ children, className }: CardProps) {
  return (
    <View className={cn("rounded-card border border-border bg-card p-4", className)}>
      {children}
    </View>
  );
});
