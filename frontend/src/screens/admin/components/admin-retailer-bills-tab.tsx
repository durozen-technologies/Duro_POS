import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { buildRetailerShareReceiptHtml } from "@/api/retailer-receipts";
import {
  cancelAdminRetailerSale,
  fetchAdminRetailerSale,
  fetchAllAdminRetailerSales,
  fetchRetailerBalance,
  settleAdminRetailerOutstanding,
} from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import { RetailerBulkSettleModal } from "@/components/retailer-bulk-settle-modal";
import { useReceiptImageShare } from "@/hooks/use-receipt-image-share";
import type { RetailerBulkSettleRead, RetailerSaleRead, UUID } from "@/types/api";
import { RetailerSaleStatus } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { computeSettleableOutstanding, sumPendingBillsBalance } from "@/utils/retailer-bulk-settle";
import {
  formatRetailerSaleNoDisplay,
  isPendingRetailerSale,
  isSettledRetailerSale,
  pickRetailerShareReceipt,
  sortRetailerSalesByNo,
} from "@/utils/retailer-sale";

import { AdminRetailerSaleActionRow } from "./admin-retailer-sale-action-row";
import { AdminRetailerSaleEditModal } from "./admin-retailer-sale-edit-modal";
import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { AdminSegmentedTabs } from "./admin-design-system";
import { EmptyStateCard } from "./admin-dashboard-primitives";

type BillsFilter = "pending" | "paid";

type AdminRetailerBillsTabProps = {
  retailerId: UUID;
  retailerName: string;
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  onOpenSale: (saleId: UUID) => void;
  onSettled?: () => void;
};

type BillRowProps = {
  sale: RetailerSaleRead;
  filter: BillsFilter;
  palette: ThemePalette;
  sharingSaleId: UUID | null;
  onPress: () => void;
  onShare: () => void;
  onEdit: () => void;
  onCancel: () => void;
};

const BillRow = memo(function BillRow({
  sale,
  filter,
  palette,
  sharingSaleId,
  onPress,
  onShare,
  onEdit,
  onCancel,
}: BillRowProps) {
  const pending = filter === "pending";
  const sharing = sharingSaleId === sale.id;

  return (
    <View
      style={[
        styles.saleCard,
        {
          borderColor: palette.border,
          backgroundColor: palette.card,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          triggerHaptic();
          onPress();
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <View style={[styles.saleHeader, { borderBottomColor: palette.border }]}>
          <View style={styles.saleHeaderText}>
            <Text
              style={[adminTypography.bodyStrong, { color: palette.textPrimary, fontSize: 16 }]}
              numberOfLines={1}
            >
              {formatRetailerSaleNoDisplay(sale.sale_no)}
            </Text>
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 2 }]}>
              {sale.shop_name} · {formatDateTime(sale.created_at)}
            </Text>
          </View>
        </View>

        <View style={styles.saleBody}>
          <View style={styles.amountRow}>
            <Text style={[adminTypography.body, { color: palette.textMuted }]}>Total</Text>
            <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>
              {formatCurrency(sale.total_amount)}
            </Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={[adminTypography.body, { color: palette.textMuted }]}>Paid</Text>
            <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>
              {formatCurrency(sale.amount_paid_total)}
            </Text>
          </View>

          {pending ? (
            <View style={[styles.highlightRow, { backgroundColor: palette.warningSoft }]}>
              <View style={styles.highlightLabelContainer}>
                <MaterialCommunityIcons name="clock-outline" size={16} color={palette.warning} />
                <Text style={[adminTypography.bodyStrong, { color: palette.warning }]}>Balance due</Text>
              </View>
              <Text
                style={[adminTypography.bodyStrong, { color: palette.warning, fontSize: 16 }]}
                numberOfLines={1}
              >
                {formatCurrency(sale.balance_due)}
              </Text>
            </View>
          ) : (
            <View style={[styles.highlightRow, { backgroundColor: palette.successSoft }]}>
              <View style={styles.highlightLabelContainer}>
                <MaterialCommunityIcons name="check-circle" size={16} color={palette.success} />
                <Text style={[adminTypography.bodyStrong, { color: palette.success }]}>Fully paid</Text>
              </View>
              <Text style={[adminTypography.bodyStrong, { color: palette.success, fontSize: 16 }]}>
                {formatCurrency(sale.total_amount)}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Share receipt for ${sale.sale_no}`}
        disabled={sharing}
        onPress={() => {
          triggerHaptic();
          onShare();
        }}
        style={({ pressed }) => [
          styles.shareButton,
          {
            borderColor: palette.border,
            backgroundColor: pressed ? palette.surfaceMuted : palette.background,
            opacity: sharing ? 0.7 : 1,
          },
        ]}
      >
        {sharing ? (
          <ActivityIndicator color={palette.primary} size="small" />
        ) : (
          <MaterialCommunityIcons name="share-variant" size={18} color={palette.primary} />
        )}
        <Text style={{ color: palette.primary, fontWeight: "700", fontSize: 13 }}>
          {sharing ? "Preparing…" : "Share receipt"}
        </Text>
      </Pressable>
      <AdminRetailerSaleActionRow
        sale={sale}
        palette={palette}
        onEdit={onEdit}
        onCancel={onCancel}
      />
    </View>
  );
});

export const AdminRetailerBillsTab = memo(function AdminRetailerBillsTab({
  retailerId,
  retailerName,
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  onOpenSale,
  onSettled,
}: AdminRetailerBillsTabProps) {
  const [sales, setSales] = useState<RetailerSaleRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BillsFilter>("pending");
  const [sharingSaleId, setSharingSaleId] = useState<UUID | null>(null);
  const [editSale, setEditSale] = useState<RetailerSaleRead | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [collectModalOpen, setCollectModalOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const { receiptImageShareBridge, startReceiptImageShare } = useReceiptImageShare();

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const [rows, balance] = await Promise.all([
          fetchAllAdminRetailerSales({ retailer_id: retailerId }),
          fetchRetailerBalance(retailerId),
        ]);
        setSales(
          sortRetailerSalesByNo(
            rows.filter(
              (sale) =>
                sale.status !== RetailerSaleStatus.VOID &&
                sale.status !== RetailerSaleStatus.CANCELLED,
            ),
          ),
        );
        setOpeningBalance(Number(balance.opening_balance ?? 0).toFixed(2));
        setError(null);
      } catch (err) {
        setError(formatApiErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
        onRefreshComplete?.();
      }
    },
    [onRefreshComplete, retailerId],
  );

  useEffect(() => {
    void load(refreshNonce > 0);
  }, [load, refreshNonce]);

  const pendingSales = useMemo(() => sales.filter(isPendingRetailerSale), [sales]);
  const paidSales = useMemo(() => sales.filter(isSettledRetailerSale), [sales]);
  const visibleSales = filter === "pending" ? pendingSales : paidSales;
  const billsOutstanding = useMemo(
    () => sumPendingBillsBalance(pendingSales.map((sale) => sale.balance_due)),
    [pendingSales],
  );
  const settleableOutstanding = useMemo(
    () => computeSettleableOutstanding(openingBalance, billsOutstanding),
    [billsOutstanding, openingBalance],
  );
  const canCollectPayment = money(settleableOutstanding).gt(0);

  const visibleTotal = useMemo(
    () =>
      filter === "pending"
        ? settleableOutstanding
        : visibleSales
            .reduce((sum, sale) => sum.plus(money(sale.total_amount)), money(0))
            .toFixed(2),
    [filter, settleableOutstanding, visibleSales],
  );

  const handleBulkSettle = useCallback(
    async (payload: { cash_amount: string; upi_amount: string }) =>
      settleAdminRetailerOutstanding(retailerId, payload),
    [retailerId],
  );

  const handleBulkSettled = useCallback(
    async (result: RetailerBulkSettleRead) => {
      Alert.alert(
        "Payment collected",
        `Applied ${formatCurrency(result.total_paid)}. Outstanding now ${formatCurrency(result.outstanding_after)}.`,
      );
      await load(true);
      onSettled?.();
    },
    [load, onSettled],
  );

  const filterTabs = useMemo(
    () => [
      {
        value: "pending" as const,
        label: `Pending (${pendingSales.length})`,
        icon: "clock-outline" as const,
      },
      {
        value: "paid" as const,
        label: `Fully Paid (${paidSales.length})`,
        icon: "check-decagram-outline" as const,
      },
    ],
    [paidSales.length, pendingSales.length],
  );

  const shareSaleReceipt = useCallback(
    async (saleId: UUID) => {
      setSharingSaleId(saleId);
      try {
        const [sale, balance] = await Promise.all([
          fetchAdminRetailerSale(saleId),
          fetchRetailerBalance(retailerId),
        ]);
        if (!pickRetailerShareReceipt(sale)) {
          Alert.alert("Receipt unavailable", "This bill does not have a printable receipt yet.");
          return;
        }
        await startReceiptImageShare(
          buildRetailerShareReceiptHtml(sale, balance.outstanding_balance, "en"),
          `Receipt ${sale.sale_no}`,
        );
      } catch (err) {
        Alert.alert("Share failed", formatApiErrorMessage(err));
      } finally {
        setSharingSaleId(null);
      }
    },
    [retailerId, startReceiptImageShare],
  );

  const handleCancelSale = useCallback(
    (sale: RetailerSaleRead) => {
      Alert.alert(
        "Cancel bill?",
        `Cancel ${formatRetailerSaleNoDisplay(sale.sale_no)}? This cannot be undone.`,
        [
          { text: "Keep bill", style: "cancel" },
          {
            text: "Cancel bill",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  await cancelAdminRetailerSale(sale.id);
                  await load(true);
                } catch (err) {
                  Alert.alert("Cancel failed", formatApiErrorMessage(err));
                }
              })();
            },
          },
        ],
      );
    },
    [load],
  );

  const handleSaleSaved = useCallback((updated: RetailerSaleRead) => {
    setSales((current) =>
      sortRetailerSalesByNo(current.map((row) => (row.id === updated.id ? updated : row))),
    );
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={palette.primary} />
        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: adminSpacing.sm }]}>
          Loading bills…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        title="Unable to load bills"
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
        onChange={(value) => setFilter(value as BillsFilter)}
      />

      <View style={[styles.summaryCard, { backgroundColor: palette.surfaceMuted }]}>
        <Text style={[adminTypography.caption, { color: palette.textMuted, fontWeight: "700" }]}>
          {filter === "pending" ? "Total outstanding" : "Total fully paid"}
        </Text>
        <Text style={[styles.summaryValue, { color: palette.textPrimary }]} numberOfLines={1}>
          {formatCurrency(visibleTotal)}
        </Text>
        <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]}>
          {filter === "pending"
            ? `${pendingSales.length} pending bill(s)`
            : `${paidSales.length} fully paid bill(s)`}
        </Text>
        {filter === "pending" ? (
          <Pressable
            accessibilityRole="button"
            disabled={!canCollectPayment}
            onPress={() => {
              triggerHaptic();
              setCollectModalOpen(true);
            }}
            style={[
              styles.collectButton,
              {
                backgroundColor: palette.primary,
                opacity: canCollectPayment ? 1 : 0.55,
              },
            ]}
          >
            <MaterialCommunityIcons name="cash-multiple" size={18} color={palette.onPrimary} />
            <Text style={{ color: palette.onPrimary, fontWeight: "800" }}>Collect payment</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={visibleSales}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={palette.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={
          <EmptyStateCard
            title={filter === "pending" ? "No pending bills" : "No fully paid bills"}
            subtitle={
              filter === "pending"
                ? "Open and partial retailer bills will appear here."
                : "Fully paid retailer bills will appear here."
            }
            palette={palette}
            icon="receipt-text-outline"
          />
        }
        renderItem={({ item }) => (
          <BillRow
            sale={item}
            filter={filter}
            palette={palette}
            sharingSaleId={sharingSaleId}
            onPress={() => onOpenSale(item.id)}
            onShare={() => void shareSaleReceipt(item.id)}
            onEdit={() => {
              setEditSale(item);
              setEditModalOpen(true);
            }}
            onCancel={() => handleCancelSale(item)}
          />
        )}
      />
      {receiptImageShareBridge}
      <AdminRetailerSaleEditModal
        visible={editModalOpen}
        sale={editSale}
        palette={palette}
        onClose={() => {
          setEditModalOpen(false);
          setEditSale(null);
        }}
        onSaved={handleSaleSaved}
      />
      <RetailerBulkSettleModal
        visible={collectModalOpen}
        retailerId={retailerId}
        retailerName={retailerName}
        openingBalance={openingBalance}
        billsOutstanding={billsOutstanding}
        palette={{
          overlay: palette.overlay,
          card: palette.card,
          border: palette.border,
          textPrimary: palette.textPrimary,
          textSecondary: palette.textSecondary,
          textMuted: palette.textMuted,
          surfaceMuted: palette.surfaceMuted,
          primary: palette.primary,
          onPrimary: palette.onPrimary,
        }}
        onClose={() => setCollectModalOpen(false)}
        onSettle={handleBulkSettle}
        onSettled={handleBulkSettled}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  summaryCard: {
    borderRadius: adminRadii.card,
    padding: 14,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "800",
    marginTop: 4,
  },
  collectButton: {
    marginTop: 12,
    borderRadius: adminRadii.control,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  saleCard: {
    borderRadius: adminRadii.card,
    borderWidth: 1,
    overflow: "hidden",
  },
  saleHeader: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  saleHeaderText: {
    minWidth: 0,
    flex: 1,
  },
  saleBody: {
    padding: 14,
    gap: 8,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  highlightRow: {
    marginTop: 4,
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  highlightLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingVertical: 12,
  },
});
