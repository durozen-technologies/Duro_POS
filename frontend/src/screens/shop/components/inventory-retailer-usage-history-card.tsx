import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { type BaseUnit, type RetailerInventoryUsageRead } from "@/types/api";
import { formatDateTime } from "@/utils/format";

type InventoryRetailerUsageHistoryCardProps = {
  entry: RetailerInventoryUsageRead;
  itemName: string;
  formatQuantity: (value: string | number, unit?: BaseUnit) => string;
  labels: {
    retailer: string;
    unknownCategory: string;
    recordedBy: (name: string) => string;
    adjustment: string;
  };
};

export function InventoryRetailerUsageHistoryCard({
  entry,
  itemName,
  formatQuantity,
  labels,
}: InventoryRetailerUsageHistoryCardProps) {
  const accentColor = "#B45309";
  const accentSoft = "#FFF7ED";

  return (
    <Card className="gap-0 border-border bg-card p-0">
      <View className="flex-row items-start gap-3 px-3.5 py-3">
        <View
          className="mt-0.5 h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: accentSoft }}
        >
          <MaterialCommunityIcons name="store-outline" size={22} color={accentColor} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={2}>
              {itemName}
            </Text>
            <Text className="text-sm font-extrabold" style={{ color: accentColor }}>
              {formatQuantity(entry.quantity, entry.unit)}
            </Text>
          </View>
          <Text className="text-xs font-semibold text-muted">
            {labels.retailer}: {entry.retailer_name ?? "—"}
          </Text>
          {entry.category_name ? (
            <Text className="text-xs font-semibold text-muted">{entry.category_name}</Text>
          ) : null}
          <Text className="text-xs font-semibold text-muted">{formatDateTime(entry.occurred_at)}</Text>
          {entry.created_by_name ? (
            <Text className="text-xs font-semibold text-muted">
              {labels.recordedBy(entry.created_by_name)}
            </Text>
          ) : null}
          {entry.adjustment_reason ? (
            <Text className="text-xs font-semibold text-muted">
              {labels.adjustment}: {entry.adjustment_reason}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
