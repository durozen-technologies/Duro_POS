import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/screens/admin/components/admin-dashboard-primitives";
import type { ThemePalette } from "@/screens/admin/admin-dashboard-theme";
import { adminRadii, adminSpacing, adminTypography } from "@/screens/admin/admin-dashboard-theme";
import {
  formatCompactCurrency,
  formatRelativeTime,
  getUnitLabel,
} from "@/screens/admin/admin-dashboard-utils";
import type { ShopDashboardRow } from "@/screens/admin/hooks/use-admin-dashboard-data";
import type { ItemSalesSummary, ShopRead, UUID } from "@/types/api";
import { formatCurrency } from "@/utils/format";

type InventoryItemCardProps = {
  item: ItemSalesSummary;
  itemRevenueAverage: number;
  palette: ThemePalette;
};

export const InventoryItemCard = memo(function InventoryItemCard({
  item,
  itemRevenueAverage,
  palette,
}: InventoryItemCardProps) {
  const itemTotal = Number(item.total_amount);
  const isHot = itemTotal >= itemRevenueAverage;

  return (
    <View
      style={[
        styles.itemCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <View style={styles.itemTextWrap}>
            <Text style={[styles.itemTitle, { color: palette.textPrimary }]}>{item.item_name}</Text>
            <Text style={[styles.itemSubtitle, { color: palette.textMuted }]}>
              {getUnitLabel(item.base_unit, item.quantity_sold)} · {item.bill_count} bills
            </Text>
          </View>
          <View style={[styles.stateChip, { backgroundColor: isHot ? palette.successSoft : palette.surfaceMuted }]}>
            <Text style={[styles.stateChipText, { color: isHot ? palette.success : palette.textMuted }]}>
              {isHot ? "Hot" : "Steady"}
            </Text>
          </View>
        </View>
        <Text style={[styles.itemAmount, { color: palette.textPrimary }]}>{formatCurrency(item.total_amount)}</Text>
      </View>
    </View>
  );
});

type BranchControlCardProps = {
  row: ShopDashboardRow;
  rank: number;
  palette: ThemePalette;
  statusUpdating: boolean;
  onManage: (shop: ShopRead) => void;
  onToggle: (shopId: UUID, isActive: boolean) => void;
};

export const BranchControlCard = memo(function BranchControlCard({
  row,
  rank,
  palette,
  statusUpdating,
  onManage,
  onToggle,
}: BranchControlCardProps) {
  const statusColor =
    row.status === "ACTIVE"
      ? palette.success
      : row.status === "IDLE"
        ? palette.cash
        : row.status === "DISABLED"
          ? palette.danger
          : palette.textMuted;

  return (
    <View
      style={[
        styles.branchCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.branchHeader}>
        <View style={styles.branchIdentity}>
          <View style={styles.branchTextWrap}>
            <View style={styles.branchTitleRow}>
              <Text style={[styles.rankBadgeText, { color: palette.textMuted }]}>#{rank}</Text>
              <Text style={[styles.branchName, { color: palette.textPrimary }]}>{row.shop.name}</Text>
            </View>
            <Text style={[styles.branchStatusNote, { color: palette.textSecondary }]}>{row.shop.username}</Text>
          </View>
        </View>
        <View style={[styles.stateChip, { backgroundColor: `${statusColor}18` }]}>
          <View style={[styles.onlineDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.stateChipText, { color: statusColor }]}>{row.status}</Text>
        </View>
      </View>

      <View style={styles.branchMetricsRow}>
        <View style={[styles.branchMetric, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <Text style={[styles.branchMetricLabel, { color: palette.textMuted }]}>Revenue</Text>
          <Text style={[styles.branchMetricValue, { color: palette.textPrimary }]}>
            {formatCompactCurrency(row.totalSales)}
          </Text>
        </View>
        <View style={[styles.branchMetric, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <Text style={[styles.branchMetricLabel, { color: palette.textMuted }]}>Bills</Text>
          <Text style={[styles.branchMetricValue, { color: palette.textPrimary }]}>{row.billCount}</Text>
        </View>
        <View style={[styles.branchMetric, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <Text style={[styles.branchMetricLabel, { color: palette.textMuted }]}>Last Active</Text>
          <Text style={[styles.branchMetricValue, { color: palette.textPrimary }]}>
            {formatRelativeTime(row.lastActivityAt)}
          </Text>
        </View>
      </View>

      <View style={[styles.branchFooter, { borderTopColor: palette.border }]}>
        <View style={styles.branchActionRow}>
          <View style={styles.branchActionButton}>
            <PrimaryButton
              label="Manage Access"
              onPress={() => onManage(row.shop)}
              variant="info"
              icon="pencil-box-outline"
              fullWidth
              palette={palette}
            />
          </View>
          <View style={styles.branchActionButton}>
            <PrimaryButton
              label={row.shop.is_active ? "Pause" : "Activate"}
              onPress={() => onToggle(row.shop.id, !row.shop.is_active)}
              loading={statusUpdating}
              variant={row.shop.is_active ? "warning" : "success"}
              icon={row.shop.is_active ? "pause-circle-outline" : "check-circle-outline"}
              fullWidth
              palette={palette}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

type AdminLogoutCardProps = {
  palette: ThemePalette;
  onLogout: () => void;
};

export const AdminLogoutCard = memo(function AdminLogoutCard({ palette, onLogout }: AdminLogoutCardProps) {
  return (
    <Pressable
      onPress={onLogout}
      style={[
        styles.logoutRow,
        { backgroundColor: palette.dangerSoft, borderColor: palette.danger },
      ]}
    >
      <MaterialCommunityIcons name="logout" size={20} color={palette.danger} />
      <View style={styles.logoutTextWrap}>
        <Text style={[styles.logoutText, { color: palette.textPrimary }]}>Sign Out Admin</Text>
        <Text style={[styles.logoutHint, { color: palette.textMuted }]}>Clears session and returns to login</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={palette.textPrimary} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  logoutIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutTextWrap: {
    flex: 1,
    gap: 2,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "700",
  },
  logoutHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: adminSpacing.sm,
  },
  itemContent: {
    flex: 1,
    gap: 6,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTextWrap: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  itemSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  itemAmount: {
    ...adminTypography.money,
  },
  stateChip: {
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stateChipText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  branchCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  branchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  branchIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  branchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  branchTextWrap: {
    flex: 1,
    gap: 4,
  },
  branchTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  rankBadge: {
    minWidth: 30,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  branchName: {
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  branchStatusNote: {
    fontSize: 12,
    lineHeight: 17,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  branchMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  branchMetric: {
    minWidth: 88,
    flex: 1,
    gap: 3,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  branchMetricLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  branchMetricValue: {
    ...adminTypography.bodyStrong,
    fontVariant: ["tabular-nums"],
  },
  branchFooter: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 12,
  },
  branchActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  branchActionButton: {
    flex: 1,
    minWidth: 110,
    minHeight: 48,
  },
});
