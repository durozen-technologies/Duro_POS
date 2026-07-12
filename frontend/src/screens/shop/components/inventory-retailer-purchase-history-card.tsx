import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";

import { Card } from "@/components/ui/card";
import { BaseUnit, type RetailerInventoryPurchaseRead } from "@/types/api";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { ShopText as Text } from "@/components/ui/shop-text";

type InventoryRetailerPurchaseHistoryCardProps = {
  purchase: RetailerInventoryPurchaseRead;
  formatQuantity: (value: string | number, unit?: BaseUnit) => string;
  labels: {
    retailer: string;
    applied: string;
    deposited: string;
    total: string;
    birds?: string;
  };
};

export function InventoryRetailerPurchaseHistoryCard({
  purchase,
  formatQuantity,
  labels,
}: InventoryRetailerPurchaseHistoryCardProps) {
  const accentColor = "#0F7642";
  const accentSoft = "#E8F3EB";
  const birdsLabel = labels.birds ?? "Count";

  return (
    <Card className="gap-0 border-border bg-card p-0">
      <View className="flex-row items-start gap-3 px-3.5 py-3">
        <View
          className="mt-0.5 h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: accentSoft }}
        >
          <MaterialCommunityIcons name="cart-arrow-down" size={22} color={accentColor} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={2}>
              {purchase.retailer_name ?? labels.retailer}
            </Text>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: accentSoft }}>
              <Text className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: accentColor }}>
                {labels.total}
              </Text>
            </View>
          </View>
          {purchase.shop_name ? (
            <Text className="text-xs font-semibold text-muted" numberOfLines={1}>
              {purchase.shop_name}
            </Text>
          ) : null}
          <Text className="text-sm font-extrabold text-ink">
            {formatCurrency(purchase.total_amount)}
          </Text>
          <Text className="text-xs font-semibold text-muted">
            {labels.applied}: {formatCurrency(purchase.amount_applied_to_outstanding)}
          </Text>
          <Text className="text-xs font-semibold text-muted">
            {labels.deposited}: {formatCurrency(purchase.amount_deposited_to_wallet)}
          </Text>
          <Text className="text-xs font-semibold text-muted">{formatDateTime(purchase.created_at)}</Text>
        </View>
      </View>

      {purchase.lines.length > 0 ? (
        <View className="border-t border-border/80 bg-surface px-3.5 py-2.5">
          {purchase.lines.map((line) => (
            <View
              key={line.id}
              className="min-h-[40px] flex-row items-center justify-between gap-3 py-1"
            >
              <Text className="min-w-0 flex-1 text-sm font-semibold text-ink" numberOfLines={2}>
                {line.item_name}
              </Text>
              <Text className="shrink-0 text-right text-sm font-extrabold text-ink">
                {line.bird_count > 0
                  ? `${formatQuantity(line.quantity)} · ${line.bird_count} ${birdsLabel} × ${formatCurrency(line.price_per_unit)}`
                  : `${formatQuantity(line.quantity)} × ${formatCurrency(line.price_per_unit)}`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
