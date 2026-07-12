import { View } from "react-native";

import { Card } from "@/components/ui/card";
import { ShopText as Text } from "@/components/ui/shop-text";

type StatCardProps = {
  label: string;
  value: string;
};

export function StatCard({ label, value }: StatCardProps) {
  return (
    <Card className="min-w-[132px] flex-1 basis-[148px] gap-2">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</Text>
      <Text className="text-xl font-bold tabular-nums text-ink">{value}</Text>
    </Card>
  );
}
