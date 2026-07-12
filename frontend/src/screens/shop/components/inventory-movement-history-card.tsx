import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { Card } from "@/components/ui/card";
import { BaseUnit, InventoryMovementType } from "@/types/api";
import type { GroupedInventoryMovement } from "@/utils/group-inventory-movements";
import { formatDateTime } from "@/utils/format";
import { ShopText as Text } from "@/components/ui/shop-text";

type InventoryMovementHistoryCardProps = {
  entry: GroupedInventoryMovement;
  itemName: string;
  formatQuantity: (value: string | number, unit?: BaseUnit) => string;
  labels: {
    added: string;
    used: string;
    unknownCategory: string;
    driver: string;
    vehicle: string;
    recordedAt: (dateTime: string) => string;
    birds?: string;
  };
};

function movementRecordedLabel(
  occurredAt: string,
  createdAt: string,
  recordedAt: (dateTime: string) => string,
) {
  const delta = Math.abs(new Date(createdAt).getTime() - new Date(occurredAt).getTime());
  if (delta <= 60_000) {
    return null;
  }
  return recordedAt(formatDateTime(createdAt));
}

function movementTextValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function TransportDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.transportDetailRow}>
      <Text style={styles.transportDetailLabel}>{label}</Text>
      <Text selectable style={styles.transportDetailValue}>
        {value}
      </Text>
    </View>
  );
}

export function InventoryMovementHistoryCard({
  entry,
  itemName,
  formatQuantity,
  labels,
}: InventoryMovementHistoryCardProps) {
  const isAdd = entry.movement_type === InventoryMovementType.ADD;
  const accentColor = isAdd ? "#168A5B" : "#9F4335";
  const accentSoft = isAdd ? "#E8F6EF" : "#FFF2EF";
  const movementLabel = isAdd ? labels.added : labels.used;
  const recordedLabel = movementRecordedLabel(entry.occurred_at, entry.created_at, labels.recordedAt);
  const vehicleNumber = movementTextValue(entry.vehicle_number);
  const driverName = movementTextValue(entry.driver_name);
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
          <MaterialCommunityIcons
            name={isAdd ? "plus-circle-outline" : "minus-circle-outline"}
            size={22}
            color={accentColor}
          />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={2}>
              {itemName}
            </Text>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: accentSoft }}>
              <Text className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: accentColor }}>
                {movementLabel}
              </Text>
            </View>
          </View>
          <Text className="text-sm font-extrabold text-ink">
            {quantityLabel}
          </Text>
          <Text className="text-xs font-semibold text-muted">{formatDateTime(entry.occurred_at)}</Text>
          {recordedLabel ? (
            <Text className="text-[11px] font-semibold text-muted">{recordedLabel}</Text>
          ) : null}
        </View>
      </View>

      {isAdd && (driverName || vehicleNumber) ? (
        <View className="gap-2.5 border-t border-border/80 bg-surface px-3.5 py-2.5">
          {driverName ? (
            <TransportDetailRow label={labels.driver} value={driverName} />
          ) : null}
          {vehicleNumber ? (
            <TransportDetailRow label={labels.vehicle} value={vehicleNumber} />
          ) : null}
        </View>
      ) : null}

      {!isAdd && entry.categories.length > 0 ? (
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
                {entry.unit === BaseUnit.KG && category.bird_count > 0
                  ? `${formatQuantity(category.quantity, entry.unit)} · ${category.bird_count} ${birdsLabel}`
                  : formatQuantity(category.quantity, entry.unit)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  transportDetailRow: {
    alignSelf: "stretch",
    gap: 4,
    width: "100%",
  },
  transportDetailLabel: {
    color: "#7A857E",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  transportDetailValue: {
    color: "#111811",
    flexShrink: 0,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
