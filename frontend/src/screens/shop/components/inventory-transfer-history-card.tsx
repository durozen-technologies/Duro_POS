import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { Card } from "@/components/ui/card";
import { BaseUnit, type InventoryTransferRead } from "@/types/api";
import { formatDateTime } from "@/utils/format";
import { ShopText as Text } from "@/components/ui/shop-text";

type InventoryTransferHistoryCardProps = {
  transfer: InventoryTransferRead;
  itemName: string;
  formatQuantity: (value: string | number, unit?: BaseUnit) => string;
  labels: {
    transferredTo: string;
    recordedAt: (dateTime: string) => string;
  };
};

function transferRecordedLabel(
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

export function InventoryTransferHistoryCard({
  transfer,
  itemName,
  formatQuantity,
  labels,
}: InventoryTransferHistoryCardProps) {
  const recordedLabel = transferRecordedLabel(transfer.occurred_at, transfer.created_at, labels.recordedAt);
  const accentColor = "#0D76A8";
  const accentSoft = "#E3EEF3";

  return (
    <Card className="gap-0 border-border bg-card p-0">
      <View className="flex-row items-start gap-3 px-3.5 py-3">
        <View
          className="mt-0.5 h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: accentSoft }}
        >
          <MaterialCommunityIcons name="truck-delivery-outline" size={22} color={accentColor} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={2}>
              {itemName}
            </Text>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: accentSoft }}>
              <Text className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: accentColor }}>
                Transfer
              </Text>
            </View>
          </View>
          <Text className="text-sm font-extrabold text-ink">
            {transfer.unit === BaseUnit.KG && transfer.bird_count > 0
              ? `${formatQuantity(transfer.quantity, transfer.unit)} · ${transfer.bird_count} Count`
              : formatQuantity(transfer.quantity, transfer.unit)}
          </Text>
          <Text className="text-xs font-semibold text-muted">{formatDateTime(transfer.occurred_at)}</Text>
          {recordedLabel ? (
            <Text className="text-[11px] font-semibold text-muted">{recordedLabel}</Text>
          ) : null}
        </View>
      </View>

      <View className="gap-2.5 border-t border-border/80 bg-surface px-3.5 py-2.5">
        <TransportDetailRow label={labels.transferredTo} value={transfer.transfer_shop_name ?? ""} />
      </View>
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
