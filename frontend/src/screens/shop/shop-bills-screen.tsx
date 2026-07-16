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
  UIManager,
  View,
} from "react-native";

import { fetchShopBills } from "@/api/billing";
import { formatApiErrorMessage, toApiError } from "@/api/client";

import { ShopHeaderActions } from "@/components/shop-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { ShopText as Text } from "@/components/ui/shop-text";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { appTheme } from "@/constants/theme";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation, type ShopTranslationKey } from "@/hooks/use-shop-translation";
import type { ShopBillsScreenProps } from "@/navigation/types";
import {
  SHOP_BILLS_PAGE_SIZE_OPTIONS,
  useShopBillsPrefsStore,
  type ShopBillsPageSize,
} from "@/store/shop-bills-prefs-store";
import {
  BillStatus,
  type ReceiptStatus,
  type ShopBillPaymentMethodFilter,
  type ShopBillSummaryRead,
} from "@/types/api";
import {
  buildExpenseHistoryRange,
  createExpenseHistoryFilterDraft,
  type ExpenseHistoryFilterDraft,
  type ExpenseHistoryInterval,
} from "@/utils/expense-history-filters";
import { formatCurrency, formatDateTime } from "@/utils/format";

const BILL_SEARCH_DEBOUNCE_MS = 350;

const isNewArchitecture = Boolean(
  (globalThis as typeof globalThis & { nativeFabricUIManager?: unknown }).nativeFabricUIManager,
);
if (Platform.OS === "android" && !isNewArchitecture && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const INTERVAL_LABEL_KEYS: Record<ExpenseHistoryInterval, ShopTranslationKey> = {
  today: "bills.intervalToday",
  date: "bills.intervalDate",
  range: "bills.intervalRange",
  week: "bills.intervalWeek",
  month: "bills.intervalMonth",
  year: "bills.intervalYear",
  all: "bills.intervalAll",
};

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 28,
  },
  headerBlock: {
    gap: 10,
    marginBottom: 6,
  },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: appTheme.text,
  },
  clearButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 12,
  },
  clearButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: appTheme.accentDeep,
  },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 14,
  },
  filterToggleActive: {
    borderColor: appTheme.accent,
    backgroundColor: appTheme.accentSoft,
  },
  filterToggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: appTheme.text,
  },
  activeBadge: {
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: appTheme.accent,
    paddingHorizontal: 6,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    fontVariant: ["tabular-nums"],
  },
  advancedCard: {
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
  },
  filterGroup: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: appTheme.text,
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
  billRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
    gap: 12,
  },
  billRowCancelled: {
    opacity: 0.78,
    borderColor: appTheme.danger,
    backgroundColor: appTheme.dangerSoft,
  },
  billTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  billIcon: {
    height: 42,
    width: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: appTheme.accentSoft,
  },
  billIconCancelled: {
    backgroundColor: "#F3D4CE",
  },
  billNo: {
    fontSize: 16,
    fontWeight: "800",
    color: appTheme.text,
    fontVariant: ["tabular-nums"],
  },
  billMeta: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: appTheme.muted,
  },
  billTotal: {
    fontSize: 17,
    fontWeight: "800",
    color: appTheme.accentDeep,
    fontVariant: ["tabular-nums"],
  },
  billTotalCancelled: {
    color: appTheme.danger,
    textDecorationLine: "line-through",
  },
  billPills: {
    alignItems: "flex-end",
    gap: 6,
    maxWidth: "44%",
  },
  billFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appTheme.border,
    paddingTop: 12,
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
  paginationBar: {
    marginTop: 8,
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
  },
  paginationMetaBlock: {
    gap: 2,
  },
  paginationMeta: {
    fontSize: 14,
    fontWeight: "700",
    color: appTheme.text,
  },
  paginationSub: {
    fontSize: 12,
    fontWeight: "600",
    color: appTheme.muted,
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  pageSizeGroup: {
    gap: 6,
  },
  pageSizeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  paginationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  skeletonBlock: {
    gap: 12,
  },
  skeletonSummary: {
    height: 48,
    borderRadius: 12,
    backgroundColor: appTheme.surface,
  },
  skeletonSearch: {
    height: 72,
    borderRadius: 12,
    backgroundColor: appTheme.surface,
  },
  skeletonFilter: {
    height: 140,
    borderRadius: 14,
    backgroundColor: appTheme.surface,
  },
  skeletonRow: {
    height: 118,
    borderRadius: 14,
    backgroundColor: appTheme.surface,
  },
  separator: {
    height: 10,
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

function paymentMethodLabel(
  method: ShopBillPaymentMethodFilter | string,
  t: (key: ShopTranslationKey) => string,
) {
  switch (String(method).trim().toLowerCase()) {
    case "cash":
      return t("bills.paymentCash");
    case "upi":
      return t("bills.paymentUpi");
    case "mixed":
    case "cash + upi":
      return t("bills.paymentMixed");
    default:
      return method;
  }
}

function localizePeriodLabel(
  interval: ExpenseHistoryInterval,
  rangeLabel: string,
  isValid: boolean,
  t: (key: ShopTranslationKey) => string,
) {
  if (!isValid) return t("bills.invalidDateRange");
  if (interval === "today" || interval === "all") {
    return t(INTERVAL_LABEL_KEYS[interval]);
  }
  return rangeLabel;
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
  t: (key: ShopTranslationKey, params?: Record<string, string>) => string;
};

const BillRow = memo(function BillRow({ bill, onPress, t }: BillRowProps) {
  const cancelled = bill.status === BillStatus.CANCELLED;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${bill.bill_no}, ${formatCurrency(bill.grand_total)}${cancelled ? `, ${t("bills.statusCancelled")}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.billRow,
        cancelled ? styles.billRowCancelled : null,
        pressed ? { opacity: 0.92 } : null,
      ]}
    >
      <View style={styles.billTop}>
        <View style={[styles.billIcon, cancelled ? styles.billIconCancelled : null]}>
          <MaterialCommunityIcons
            name={cancelled ? "receipt-text-remove-outline" : "receipt-text-outline"}
            size={20}
            color={cancelled ? appTheme.danger : appTheme.accent}
          />
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
        <View style={styles.billPills}>
          <Text style={[styles.billTotal, cancelled ? styles.billTotalCancelled : null]}>
            {formatCurrency(bill.grand_total)}
          </Text>
          {cancelled ? (
            <StatusPill label={t("bills.statusCancelled")} tone="danger" />
          ) : (
            <StatusPill
              label={receiptStatusLabel(bill.receipt_status, t)}
              tone={receiptStatusTone(bill.receipt_status)}
            />
          )}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={appTheme.muted} />
      </View>

      <View style={styles.billFooter}>
        <View style={styles.metaPill}>
          <MaterialCommunityIcons name="cash" size={14} color={appTheme.accent} />
          <Text style={styles.metaPillText}>{paymentMethodLabel(bill.payment_method, t)}</Text>
        </View>
        <View style={styles.metaPill}>
          <MaterialCommunityIcons name="package-variant-closed" size={14} color={appTheme.muted} />
          <Text style={styles.metaPillText}>
            {t("bills.lineItemsMeta", {
              items: String(bill.total_items),
              qty: String(bill.total_quantity),
            })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

function countAdvancedFilters(
  receiptFilter: ReceiptStatus | "all",
  paymentFilter: "all" | ShopBillPaymentMethodFilter,
) {
  let count = 0;
  if (receiptFilter !== "all") count += 1;
  if (paymentFilter !== "all") count += 1;
  return count;
}

export function ShopBillsScreen({ navigation }: ShopBillsScreenProps) {
  const { t } = useShopTranslation();
  const pageSize = useShopBillsPrefsStore((state) => state.pageSize);
  const setPageSize = useShopBillsPrefsStore((state) => state.setPageSize);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [items, setItems] = useState<ShopBillSummaryRead[]>([]);
  const [billNoQuery, setBillNoQuery] = useState("");
  const [billNoDraft, setBillNoDraft] = useState("");
  const [receiptFilter, setReceiptFilter] = useState<ReceiptStatus | "all">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | ShopBillPaymentMethodFilter>("all");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [dateFilter, setDateFilter] = useState<ExpenseHistoryFilterDraft>(() => createExpenseHistoryFilterDraft());
  const reduceMotionRef = useRef(false);
  const requestSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  const dateRange = useMemo(() => buildExpenseHistoryRange(dateFilter), [dateFilter]);
  const advancedFilterCount = countAdvancedFilters(receiptFilter, paymentFilter);
  const searchActive = billNoQuery.trim().length > 0;
  const filtersActive = advancedFilterCount > 0 || searchActive;
  const dateFilterActive = dateFilter.interval !== "all";
  const periodLabel = localizePeriodLabel(
    dateFilter.interval,
    dateRange.label,
    dateRange.isValid,
    t,
  );

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => subscription.remove();
  }, []);

  // Debounce bill-number search so staff can type without a fetch per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = billNoDraft.trim();
      setBillNoQuery((current) => {
        if (current === next) return current;
        setPage(1);
        return next;
      });
    }, BILL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [billNoDraft]);

  const animateList = useCallback(() => {
    if (reduceMotionRef.current) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!dateRange.isValid && dateFilter.interval !== "all") {
      setItems([]);
      setTotalCount(0);
      setTotalPages(0);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const result = await fetchShopBills({
        page,
        page_size: pageSize,
        bill_no: billNoQuery.trim() || undefined,
        range_start_date: dateRange.rangeStartDate ?? undefined,
        range_end_date: dateRange.rangeEndDate ?? undefined,
        receipt_status: receiptFilter === "all" ? undefined : receiptFilter,
        payment_method: paymentFilter === "all" ? undefined : paymentFilter,
        sort_by: "created_at",
        sort_dir: "desc",
      });
      if (seq !== requestSeqRef.current) return;
      animateList();
      setItems(result.items);
      setTotalPages(result.total_pages);
      setTotalCount(result.total_count);
      // Clamp page if server returned fewer pages (e.g. after filter/page-size change).
      if (result.total_pages > 0 && page > result.total_pages) {
        setPage(result.total_pages);
      }
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      // Silent refresh should not interrupt staff with dialogs.
      if (options?.silent) {
        return;
      }
      const apiError = toApiError(error);
      const status = apiError.status;
      // 503/502 = tenant/schema/backend outage — not a filter problem.
      let hint = "";
      if (status === 502 || status === 503) {
        hint = `\n\n${t("bills.loadFailedUnavailableHint")}`;
      } else if (
        (receiptFilter !== "all" || paymentFilter !== "all") &&
        status !== undefined &&
        status >= 500
      ) {
        hint = `\n\n${t("bills.loadFailedFilterHint")}`;
      }
      Alert.alert(t("bills.loadFailed"), `${formatApiErrorMessage(error)}${hint}`);
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    animateList,
    billNoQuery,
    dateFilter.interval,
    dateRange.isValid,
    dateRange.rangeEndDate,
    dateRange.rangeStartDate,
    page,
    pageSize,
    paymentFilter,
    receiptFilter,
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
      // Avoid double-fetch on first mount; refresh silently when returning to screen.
      if (!hasLoadedOnceRef.current) return;
      void load({ silent: true });
    }, [load]),
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

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <View style={styles.summaryStrip}>
          <MaterialCommunityIcons name="file-document-multiple-outline" size={20} color={appTheme.accent} />
          <Text style={[styles.summaryTitle, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
            {t("bills.periodSummary", {
              count: String(totalCount),
              period: periodLabel,
            })}
          </Text>
          {filtersActive || dateFilterActive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("bills.clearFilters")}
              onPress={clearAllFilters}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonLabel}>{t("bills.clearFilters")}</Text>
            </Pressable>
          ) : null}
        </View>

        <TextField
          label={t("bills.searchBillNo")}
          value={billNoDraft}
          onChangeText={setBillNoDraft}
          placeholder={t("bills.searchBillNoPlaceholder")}
          onSubmitEditing={() => {
            const next = billNoDraft.trim();
            setBillNoQuery(next);
            setPage(1);
          }}
        />


        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
          onPress={() => {
            if (!reduceMotionRef.current) {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            }
            setFiltersExpanded((current) => !current);
          }}
          style={[styles.filterToggle, advancedFilterCount > 0 ? styles.filterToggleActive : null]}
        >
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.filterToggleLabel}>
              {filtersExpanded ? t("bills.lessFilters") : t("bills.moreFilters")}
            </Text>
            {advancedFilterCount > 0 ? (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{String(advancedFilterCount)}</Text>
              </View>
            ) : null}
          </View>
          <MaterialCommunityIcons
            name={filtersExpanded ? "chevron-up" : "chevron-down"}
            size={22}
            color={appTheme.muted}
          />
        </Pressable>

        {filtersExpanded ? (
          <View style={styles.advancedCard}>
            <View style={styles.filterGroup}>
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
            <View style={styles.filterGroup}>
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
          </View>
        ) : null}
      </View>
    ),
    [
      advancedFilterCount,
      billNoDraft,
      clearAllFilters,
      dateFilter,
      dateFilterActive,
      dateRange,
      filtersActive,
      filtersExpanded,

      paymentFilter,
      paymentFilterOptions,
      periodLabel,
      receiptFilter,
      receiptFilterOptions,
      t,
      totalCount,
    ],
  );

  const onPageSizeChange = useCallback(
    (next: ShopBillsPageSize) => {
      if (next === pageSize) return;
      setPageSize(next);
      setPage(1);
    },
    [pageSize, setPageSize],
  );

  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = totalCount === 0 ? 0 : Math.min(page * pageSize, totalCount);
  const safeTotalPages = Math.max(totalPages, totalCount === 0 ? 0 : 1);

  const listFooter = useMemo(
    () => (
      <View style={styles.paginationBar}>
        <View style={styles.paginationMetaBlock}>
          <Text style={styles.paginationMeta}>
            {t("bills.rangeSummary", {
              from: String(rangeFrom),
              to: String(rangeTo),
              total: String(totalCount),
            })}
          </Text>
          <Text style={styles.paginationSub}>
            {t("bills.pageSummary", {
              page: String(safeTotalPages === 0 ? 0 : page),
              totalPages: String(safeTotalPages),
            })}
          </Text>
        </View>

        <View style={styles.pageSizeGroup}>
          <Text style={styles.sectionLabel}>{t("bills.pageSizeLabel")}</Text>
          <View style={styles.pageSizeRow}>
            {SHOP_BILLS_PAGE_SIZE_OPTIONS.map((size) => (
              <FilterChip
                key={size}
                label={String(size)}
                active={pageSize === size}
                onPress={() => onPageSizeChange(size)}
              />
            ))}
          </View>
        </View>

        <View style={styles.paginationRow}>
          <View style={styles.paginationActions}>
            <Button
              label={t("bills.prevPage")}
              onPress={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              variant="secondary"
              size="sm"
            />
            <Button
              label={t("bills.nextPage")}
              onPress={() => setPage((current) => Math.min(Math.max(safeTotalPages, 1), current + 1))}
              disabled={page >= safeTotalPages || loading || totalCount === 0}
              variant="secondary"
              size="sm"
            />
          </View>
        </View>
      </View>
    ),
    [
      loading,
      onPageSizeChange,
      page,
      pageSize,
      rangeFrom,
      rangeTo,
      safeTotalPages,
      t,
      totalCount,
    ],
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
        <View style={styles.skeletonBlock}>
          <View style={styles.skeletonSummary} />
          <View style={styles.skeletonSearch} />
          <View style={styles.skeletonFilter} />
          {Array.from({ length: 3 }).map((_, index) => (
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 ? { flexGrow: 1 } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={pageSize}
        maxToRenderPerBatch={pageSize}
        windowSize={5}
        removeClippedSubviews
      />
    </Screen>
  );
}
