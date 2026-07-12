import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";

import { Card } from "@/components/ui/card";
import { BaseUnit } from "@/types/api";
import { formatDateTime } from "@/utils/format";
import type { GroupedRetailerInventoryUsage } from "@/utils/group-retailer-inventory-usages";
import { ShopText as Text } from "@/components/ui/shop-text";

type InventoryRetailerUsageHistoryCardProps = {
  entry: GroupedRetailerInventoryUsage;
  itemName: string;
  formatQuantity: (value: string | number, unit?: BaseUnit) => string;
  labels: {
    retailer: string;
    unknownCategory: string;
    recordedBy: (name: string) => string;
    adjustment: string;
    birds?: string;
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
  const birdsLabel = labels.birds ?? "Count";
  const quantityLabel =
    entry.unit === BaseUnit.KG && entry.total_bird_count > 0
      ? `${formatQuantity(entry.total_quantity, entry.unit)} · ${entry.total_bird_count} ${birdsLabel}`
      : formatQuantity(entry.total_quantity, entry.unit);

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
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: accentSoft }}>
              <Text className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: accentColor }}>
                {labels.retailer}
              </Text>
            </View>
          </View>
          <Text className="text-sm font-extrabold text-ink">
            {quantityLabel}
          </Text>
          <Text className="text-xs font-semibold text-muted">
            {labels.retailer}: {entry.retailer_name ?? "—"}
          </Text>
          {entry.shop_name ? (
            <Text className="text-xs font-semibold text-muted" numberOfLines={1}>
              {entry.shop_name}
            </Text>
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

      {entry.categories.length > 0 ? (
        <View className="border-t border-border/80 bg-surface px-3.5 py-2.5">
          {entry.categories.map((category, index) => (
            <View
              key={`${category.category_id ?? "none"}-${index}`}
              className="min-h-[40px] flex-row items-center justify-between gap-3 py-1"
            >
              <Text className="min-w-0 flex-1 text-sm font-semibold text-ink" numberOfLines={2}>
                {category.category_name ?? labels.unknownCategory}
              </Text>
              <Text className="shrink-0 text-sm font-extrabold text-ink">
                {formatQuantity(category.quantity, entry.unit)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
