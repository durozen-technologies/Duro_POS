import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import { fetchShopBills } from "@/api/billing";
import { toApiError } from "@/api/client";
import { ShopDateRangeFilter } from "@/components/shop/date-range-filter";
import { ShopHeaderActions } from "@/components/shop-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { appTheme } from "@/constants/theme";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation, type ShopTranslationKey } from "@/hooks/use-shop-translation";
import type { ShopBillsScreenProps } from "@/navigation/types";
import type { ReceiptStatus, ShopBillSummaryRead } from "@/types/api";
import {
  buildExpenseHistoryRange,
  createExpenseHistoryFilterDraft,
  type ExpenseHistoryFilterDraft,
} from "@/utils/expense-history-filters";
import { formatCurrency, formatDateTime } from "@/utils/format";

const isNewArchitecture = Boolean(
  (globalThis as typeof globalThis & { nativeFabricUIManager?: unknown }).nativeFabricUIManager
);
if (Platform.OS === "android" && !isNewArchitecture && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const styles = StyleSheet.create({
  filterSection: {
    gap: 12,
    marginBottom: 14,
  },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.surface,
    paddingHorizontal: 12,
  },
  advancedCard: {
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.background,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  filterChipActive: {
    borderColor: appTheme.accent,
    backgroundColor: appTheme.accentSoft,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: appTheme.muted,
  },
  filterChipLabelActive: {
    color: appTheme.accentDeep,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: appTheme.text,
  },
  billRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
    gap: 12,
  },
  billRowPressed: {
    backgroundColor: appTheme.surface,
  },
  billTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  billIconWrap: {
    height: 42,
    width: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: appTheme.accentSoft,
  },
  billNo: {
    fontSize: 17,
    fontWeight: "800",
    color: appTheme.text,
    fontVariant: ["tabular-nums"],
  },
  billMeta: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: appTheme.muted,
  },
  billTotal: {
    fontSize: 18,
    fontWeight: "800",
    color: appTheme.accentDeep,
    fontVariant: ["tabular-nums"],
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: appTheme.text,
  },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  paginationBar: {
    gap: 12,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
  },
  paginationMeta: {
    fontSize: 14,
    fontWeight: "700",
    color: appTheme.text,
  },
  paginationSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: appTheme.muted,
  },
  skeletonRow: {
    height: 112,
    borderRadius: 14,
    backgroundColor: appTheme.surface,
  },
});

function receiptStatusLabel(status: ReceiptStatus, t: (key: ShopTranslationKey) => string) {
  switch (status) {
    case "printed":
      return t("bills.receiptPrinted");
    case "pending":
      return t("bills.receiptPending");
    case "failed":
      return t("bills.receiptFailed");
    default:
      return status;
  }
}

function receiptStatusTone(status: ReceiptStatus): "success" | "warning" | "danger" {
  if (status === "printed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

type FilterChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

const FilterChip = memo(function FilterChip({ label, active, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterChip, active ? styles.filterChipActive : null]}
    >
      <Text style={[styles.filterChipLabel, active ? styles.filterChipLabelActive : null]}>{label}</Text>
    </Pressable>
  );
});

type BillRowProps = {
  bill: ShopBillSummaryRead;
  onPress: () => void;
  t: (key: ShopTranslationKey) => string;
};

const BillRow = memo(function BillRow({ bill, onPress, t }: BillRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${bill.bill_no}, ${formatCurrency(bill.grand_total)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.billRow, pressed ? styles.billRowPressed : null]}
    >
      <View style={styles.billTopRow}>
        <View style={{ flexDirection: "row", gap: 12, flex: 1, minWidth: 0 }}>
          <View style={styles.billIconWrap}>
            <MaterialCommunityIcons name="receipt-text-outline" size={22} color={appTheme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.billNo} numberOfLines={1}>
              {bill.bill_no}
            </Text>
            <Text style={styles.billMeta}>{formatDateTime(bill.created_at)}</Text>
            {bill.created_by_name ? (
              <Text style={styles.billMeta} numberOfLines={1}>
                {t("bills.createdBy")}: {bill.created_by_name}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 8 }}>
          <Text style={styles.billTotal}>{formatCurrency(bill.grand_total)}</Text>
          <StatusPill
            label={receiptStatusLabel(bill.receipt_status, t)}
            tone={receiptStatusTone(bill.receipt_status)}
          />
        </View>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaPill}>
          <MaterialCommunityIcons name="cash" size={14} color={appTheme.accent} />
          <Text style={styles.metaPillText}>{bill.payment_method}</Text>
        </View>
        <View style={styles.metaPill}>
          <MaterialCommunityIcons name="package-variant-closed" size={14} color={appTheme.muted} />
          <Text style={styles.metaPillText}>
            Items: {bill.total_items} · Quantity(Kg/Units): {bill.total_quantity}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

function hasAdvancedFilters(
  billNoQuery: string,
  receiptFilter: ReceiptStatus | "all",
  paymentFilter: "all" | "cash" | "upi" | "mixed",
  settledFilter: "all" | "settled" | "pending",
) {
  return (
    billNoQuery.trim().length > 0
    || receiptFilter !== "all"
    || paymentFilter !== "all"
    || settledFilter !== "all"
  );
}

export function ShopBillsScreen({ navigation }: ShopBillsScreenProps) {
  const { t } = useShopTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [items, setItems] = useState<ShopBillSummaryRead[]>([]);
  const [billNoQuery, setBillNoQuery] = useState("");
  const [billNoDraft, setBillNoDraft] = useState("");
  const [receiptFilter, setReceiptFilter] = useState<ReceiptStatus | "all">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "cash" | "upi" | "mixed">("all");
  const [settledFilter, setSettledFilter] = useState<"all" | "settled" | "pending">("all");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [dateFilter, setDateFilter] = useState<ExpenseHistoryFilterDraft>(() => createExpenseHistoryFilterDraft());
  const reduceMotionRef = useRef(false);

  const dateRange = useMemo(() => buildExpenseHistoryRange(dateFilter), [dateFilter]);
  const filtersActive = hasAdvancedFilters(billNoQuery, receiptFilter, paymentFilter, settledFilter);
  const dateFilterActive = dateFilter.interval !== "all";

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => subscription.remove();
  }, []);

  const animateList = useCallback(() => {
    if (reduceMotionRef.current) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!dateRange.isValid && dateFilter.interval !== "all") {
      setItems([]);
      setTotalCount(0);
      setTotalPages(1);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const result = await fetchShopBills({
        page,
        page_size: 20,
        bill_no: billNoQuery.trim() || undefined,
        range_start_date: dateRange.rangeStartDate ?? undefined,
        range_end_date: dateRange.rangeEndDate ?? undefined,
        receipt_status: receiptFilter === "all" ? undefined : receiptFilter,
        payment_method: paymentFilter === "all" ? undefined : paymentFilter,
        payment_settled:
          settledFilter === "all" ? undefined : settledFilter === "settled",
        sort_by: "created_at",
        sort_dir: "desc",
      });
      animateList();
      setItems(result.items);
      setTotalPages(Math.max(result.total_pages, 1));
      setTotalCount(result.total_count);
    } catch (error) {
      Alert.alert(t("bills.loadFailed"), toApiError(error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    animateList,
    billNoQuery,
    dateFilter.interval,
    dateRange.isValid,
    dateRange.rangeEndDate,
    dateRange.rangeStartDate,
    page,
    paymentFilter,
    receiptFilter,
    settledFilter,
    t,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: () => {
      setRefreshing(true);
      void load({ silent: true });
    },
    refreshing,
  });

  useFocusEffect(
    useCallback(() => {
      if (items.length > 0) {
        void load({ silent: true });
      }
    }, [items.length, load]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  const clearAllFilters = useCallback(() => {
    setBillNoQuery("");
    setBillNoDraft("");
    setReceiptFilter("all");
    setPaymentFilter("all");
    setSettledFilter("all");
    setDateFilter(createExpenseHistoryFilterDraft());
    setPage(1);
  }, []);

  const receiptFilterOptions = useMemo(
    () =>
      [
        { key: "all" as const, label: t("bills.filterAll") },
        { key: "printed" as const, label: t("bills.receiptPrinted") },
        { key: "pending" as const, label: t("bills.receiptPending") },
        { key: "failed" as const, label: t("bills.receiptFailed") },
      ],
    [t],
  );

  const paymentFilterOptions = useMemo(
    () =>
      [
        { key: "all" as const, label: t("bills.filterAll") },
        { key: "cash" as const, label: t("bills.paymentCash") },
        { key: "upi" as const, label: t("bills.paymentUpi") },
        { key: "mixed" as const, label: t("bills.paymentMixed") },
      ],
    [t],
  );

  const settledFilterOptions = useMemo(
    () =>
      [
        { key: "all" as const, label: t("bills.filterAll") },
        { key: "settled" as const, label: t("bills.paymentSettled") },
        { key: "pending" as const, label: t("bills.paymentPending") },
      ],
    [t],
  );

  const periodLabel = dateRange.isValid ? dateRange.label : t("bills.invalidDateRange");

  const listHeader = useMemo(
    () => (
      <View style={styles.filterSection}>
        <ShopDateRangeFilter
          filter={dateFilter}
          range={dateRange}
          onChange={(next) => {
            setDateFilter(next);
            setPage(1);
          }}
          t={t}
        />

        <View style={styles.summaryStrip}>
          <MaterialCommunityIcons name="file-document-multiple-outline" size={22} color={appTheme.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.paginationMeta}>
              {t("bills.periodSummary", {
                count: String(totalCount),
                period: periodLabel,
              })}
            </Text>
            <Text style={styles.paginationSub}>
              {t("bills.pageSummary", {
                page: String(page),
                totalPages: String(totalPages),
                totalCount: String(totalCount),
              })}
            </Text>
          </View>
          {(filtersActive || dateFilterActive) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("bills.clearFilters")}
              onPress={clearAllFilters}
              className="rounded-full border border-border bg-card px-3 py-2"
            >
              <Text className="text-xs font-bold text-accent">{t("bills.clearFilters")}</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
          onPress={() => setFiltersExpanded((current) => !current)}
          style={styles.filterToggle}
        >
          <Text style={styles.sectionLabel}>
            {filtersExpanded ? t("bills.lessFilters") : t("bills.moreFilters")}
          </Text>
          <MaterialCommunityIcons
            name={filtersExpanded ? "chevron-up" : "chevron-down"}
            size={22}
            color={appTheme.muted}
          />
        </Pressable>

        {filtersExpanded ? (
          <View style={styles.advancedCard}>
            <TextField
              label={t("bills.searchBillNo")}
              value={billNoDraft}
              onChangeText={setBillNoDraft}
              placeholder={t("bills.searchBillNoPlaceholder")}
              onSubmitEditing={() => {
                setBillNoQuery(billNoDraft);
                setPage(1);
              }}
            />
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>{t("bills.receiptStatusFilter")}</Text>
              <View style={styles.filterRow}>
                {receiptFilterOptions.map((option) => (
                  <FilterChip
                    key={option.key}
                    label={option.label}
                    active={receiptFilter === option.key}
                    onPress={() => {
                      setReceiptFilter(option.key);
                      setPage(1);
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>{t("bills.paymentMethodFilter")}</Text>
              <View style={styles.filterRow}>
                {paymentFilterOptions.map((option) => (
                  <FilterChip
                    key={option.key}
                    label={option.label}
                    active={paymentFilter === option.key}
                    onPress={() => {
                      setPaymentFilter(option.key);
                      setPage(1);
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>{t("bills.paymentStatusFilter")}</Text>
              <View style={styles.filterRow}>
                {settledFilterOptions.map((option) => (
                  <FilterChip
                    key={option.key}
                    label={option.label}
                    active={settledFilter === option.key}
                    onPress={() => {
                      setSettledFilter(option.key);
                      setPage(1);
                    }}
                  />
                ))}
              </View>
            </View>
            <Button
              label={t("bills.applyFilters")}
              onPress={() => {
                setBillNoQuery(billNoDraft);
                setPage(1);
              }}
              variant="secondary"
              className="self-start"
            />
          </View>
        ) : null}
      </View>
    ),
    [
      billNoDraft,
      clearAllFilters,
      dateFilter,
      dateFilterActive,
      dateRange,
      filtersActive,
      filtersExpanded,
      page,
      paymentFilter,
      paymentFilterOptions,
      periodLabel,
      receiptFilter,
      receiptFilterOptions,
      settledFilter,
      settledFilterOptions,
      t,
      totalCount,
      totalPages,
    ],
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.paginationBar}>
        <Text style={styles.paginationMeta}>
          {t("bills.pageSummary", {
            page: String(page),
            totalPages: String(totalPages),
            totalCount: String(totalCount),
          })}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button
            label={t("bills.prevPage")}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            variant="secondary"
            size="sm"
          />
          <Button
            label={t("bills.nextPage")}
            onPress={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            variant="secondary"
            size="sm"
          />
        </View>
      </View>
    ),
    [loading, page, t, totalCount, totalPages],
  );

  const emptyComponent = useMemo(() => {
    const filtered = filtersActive || dateFilterActive;
    return (
      <EmptyState
        title={filtered ? t("bills.noBillsInPeriod") : t("bills.emptyTitle")}
        description={
          filtered ? t("bills.noBillsInPeriodDescription") : t("bills.emptyDescription")
        }
        actionLabel={filtered ? t("bills.clearFilters") : undefined}
        onAction={filtered ? clearAllFilters : undefined}
      />
    );
  }, [clearAllFilters, dateFilterActive, filtersActive, t]);

  if (loading && items.length === 0) {
    return (
      <Screen topInset={false} scroll={false}>
        <View style={{ gap: 12 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <View key={index} style={styles.skeletonRow} />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen topInset={false} scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.bill_id}
        renderItem={({ item }) => (
          <BillRow
            bill={item}
            t={t}
            onPress={() => navigation.navigate("ShopBillDetail", { billId: item.bill_id })}
          />
        )}
        ListHeaderComponent={listHeader}
        ListFooterComponent={items.length > 0 ? listFooter : null}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load({ silent: true });
            }}
            tintColor={appTheme.accent}
            colors={[appTheme.accent]}
          />
        }
        ListEmptyComponent={emptyComponent}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: items.length === 0 ? 1 : undefined }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
    </Screen>
  );
}
