import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchAllAdminRetailerSales } from "@/api/retailers";
import { toApiError } from "@/api/client";
import { RetailerSaleStatus, type RetailerSaleRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency, formatDateTime } from "@/utils/format";
import {
  formatRetailerSaleNoDisplay,
  isPendingRetailerSale,
  isSettledRetailerSale,
  sortRetailerSalesByNo,
} from "@/utils/retailer-sale";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { AdminSegmentedTabs } from "./admin-design-system";
import { EmptyStateCard, SectionHint } from "./admin-dashboard-primitives";

type SalesFilter = "pending" | "paid";

type AdminRetailersSalesTabProps = {
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  onOpenSale: (saleId: string) => void;
};

type SaleRowProps = {
  sale: RetailerSaleRead;
  filter: SalesFilter;
  palette: ThemePalette;
  onPress: () => void;
};

const SaleRow = memo(function SaleRow({ sale, filter, palette, onPress }: SaleRowProps) {
  const pending = filter === "pending";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.saleRow,
        {
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
        },
      ]}
    >
      <View style={styles.saleRowLeft}>
        <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary, fontSize: 16 }]} numberOfLines={1}>
          {sale.retailer_name}
        </Text>
        <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]} numberOfLines={1}>
          {formatRetailerSaleNoDisplay(sale.sale_no)}
        </Text>
        <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 1 }]} numberOfLines={1}>
          {formatDateTime(sale.created_at)}
        </Text>
      </View>

      <View style={styles.saleRowRight}>
        <Text
          style={[
            adminTypography.bodyStrong,
            { 
              color: pending ? palette.warning : palette.textPrimary, 
              fontSize: 16, 
              textAlign: "right",
              fontVariant: ["tabular-nums"]
            },
          ]}
        >
          {pending ? formatCurrency(sale.balance_due) : formatCurrency(sale.total_amount)}
        </Text>
        <Text style={[adminTypography.caption, { color: pending ? palette.warning : palette.textMuted, textAlign: "right", marginTop: 2, fontWeight: '700' }]}>
          {pending ? "Balance Due" : "Settled"}
        </Text>
        {pending && (
          <Text style={[adminTypography.caption, { color: palette.textMuted, textAlign: "right", marginTop: 4, fontVariant: ["tabular-nums"] }]}>
            Total: {formatCurrency(sale.total_amount)} · Paid: {formatCurrency(sale.amount_paid_total)}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

export const AdminRetailersSalesTab = memo(function AdminRetailersSalesTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  onOpenSale,
}: AdminRetailersSalesTabProps) {
  const [sales, setSales] = useState<RetailerSaleRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SalesFilter>("pending");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const rows = sortRetailerSalesByNo(
        (await fetchAllAdminRetailerSales()).filter((sale) => sale.status !== RetailerSaleStatus.VOID),
      );
      setSales(rows);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      if (isRefresh) {
        onRefreshComplete?.();
      }
    }
  }, [onRefreshComplete]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (refreshNonce > 0) {
      void load(true);
    }
  }, [load, refreshNonce]);

  const pendingSales = useMemo(() => sales.filter(isPendingRetailerSale), [sales]);
  const paidSales = useMemo(() => sales.filter(isSettledRetailerSale), [sales]);
  const visibleSales = filter === "pending" ? pendingSales : paidSales;

  const pendingBalance = useMemo(
    () => pendingSales.reduce((sum, sale) => sum.plus(money(sale.balance_due)), money(0)).toFixed(2),
    [pendingSales],
  );

  const paidTotal = useMemo(
    () => paidSales.reduce((sum, sale) => sum.plus(money(sale.total_amount)), money(0)).toFixed(2),
    [paidSales],
  );

  const filterTabs = useMemo(
    () => [
      { value: "pending" as const, label: `Pending (${pendingSales.length})`, icon: "clock-outline" as const },
      { value: "paid" as const, label: `Paid (${paidSales.length})`, icon: "check-decagram-outline" as const },
    ],
    [paidSales.length, pendingSales.length],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="receipt-text-outline" size={32} color={palette.border} />
        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: adminSpacing.sm }]}>
          Loading sales…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        title="Unable to load sales"
        subtitle={error}
        actionLabel="Retry"
        onAction={() => void load()}
        palette={palette}
        icon="receipt-text-remove-outline"
      />
    );
  }

  return (
    <View style={styles.container}>
      <AdminSegmentedTabs
        items={filterTabs}
        activeValue={filter}
        palette={palette}
        onChange={(value) => setFilter(value as SalesFilter)}
      />

      <View style={[styles.summaryCard, { backgroundColor: palette.surfaceMuted }]}>
        <Text style={[adminTypography.caption, { color: palette.textMuted, fontWeight: "700" }]}>
          {filter === "pending" ? "Total balance due" : "Total settled"}
        </Text>
        <Text style={[styles.summaryValue, { color: palette.textPrimary }]} numberOfLines={1}>
          {formatCurrency(filter === "pending" ? pendingBalance : paidTotal)}
        </Text>
        <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]}>
          {filter === "pending"
            ? `${pendingSales.length} open or partial sale(s)`
            : `${paidSales.length} fully paid sale(s)`}
        </Text>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={visibleSales}
        keyExtractor={(item) => item.id}
        extraData={filter}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={palette.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: adminSpacing.md }} />}
        ListEmptyComponent={
          <EmptyStateCard
            title={filter === "pending" ? "No pending sales" : "No fully paid sales"}
            subtitle={
              filter === "pending"
                ? "Open and partial retailer sales will appear here."
                : "Settled retailer sales will appear here after full payment."
            }
            palette={palette}
            icon="receipt-text-outline"
          />
        }
        renderItem={({ item }) => (
          <SaleRow
            sale={item}
            filter={filter}
            palette={palette}
            onPress={() => onOpenSale(item.id)}
          />
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
  },
  summaryCard: {
    borderRadius: adminRadii.card,
    padding: adminSpacing.md,
    marginHorizontal: adminSpacing.md,
    marginBottom: adminSpacing.sm,
    marginTop: adminSpacing.sm,
  },
  summaryValue: {
    marginTop: 6,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  listContent: {
    paddingBottom: adminSpacing.lg,
  },
  saleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: adminSpacing.md,
    paddingHorizontal: adminSpacing.md,
  },
  saleRowLeft: {
    flex: 1,
    paddingRight: adminSpacing.sm,
  },
  saleRowRight: {
    alignItems: "flex-end",
  },
});
