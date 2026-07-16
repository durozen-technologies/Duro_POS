import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ComponentProps } from "react";
import { Alert, ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { buildRetailerShareReceiptHtml } from "@/api/retailer-receipts";
import {
  fetchAllShopRetailerSales,
  fetchShopRetailerOutstandingBalance,
  fetchShopRetailerSale,
} from "@/api/retailer-sales";
import { fetchShopRetailers } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { ShopHeaderActions } from "@/components/shop-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { ShopSegmentedTabs } from "@/components/ui/shop-segmented-tabs";
import { StatusPill } from "@/components/ui/status-pill";
import { appTheme } from "@/constants/theme";
import { useReceiptImageShare } from "@/hooks/use-receipt-image-share";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation, type ShopTranslationKey } from "@/hooks/use-shop-translation";
import type { RetailerSalesScreenProps } from "@/navigation/types";
import { RetailerSaleStatus, type RetailerRead, type RetailerSaleRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency, formatDateTime } from "@/utils/format";
import {
  createRetailerSalesFilterDraft,
  describeRetailerSalesFilter,
  hasActiveRetailerSalesFilters,
  saleMatchesRetailerSalesFilters,
  type RetailerSalesDateMode,
  type RetailerSalesFilterDraft,
} from "@/utils/retailer-sales-filters";
import { ShopText as Text } from "@/components/ui/shop-text";
import {
  formatRetailerSaleNoDisplay,
  isPendingRetailerSale,
  isSettledRetailerSale,
  pickRetailerShareReceipt,
  sortRetailerSalesByNo,
} from "@/utils/retailer-sale";

type SalesTab = "pending" | "paid";
type Translate = (key: ShopTranslationKey, params?: Record<string, string | number>) => string;

function mapRetailersFromSales(sales: RetailerSaleRead[]): RetailerRead[] {
  const seen = new Set<string>();
  const rows: RetailerRead[] = [];
  for (const sale of sales) {
    if (seen.has(sale.retailer_id)) {
      continue;
    }
    seen.add(sale.retailer_id);
    rows.push({
      id: sale.retailer_id,
      name: sale.retailer_name,
      phone: null,
      outstanding_balance: sale.balance_due,
      is_active: true,
      branch_names: [],
      created_at: sale.created_at,
      updated_at: sale.created_at,
    });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

const DATE_MODE_OPTIONS: { key: RetailerSalesDateMode; labelKey: ShopTranslationKey; icon: ComponentProps<typeof MaterialCommunityIcons>["name"] }[] = [
  { key: "all", labelKey: "retailers.allDates", icon: "calendar-blank-outline" },
  { key: "single", labelKey: "retailers.singleDate", icon: "calendar" },
  { key: "range", labelKey: "retailers.dateRange", icon: "calendar-range" },
];

const styles = StyleSheet.create({
  searchFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchField: {
    minHeight: 48,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 20,
    color: appTheme.text,
    paddingVertical: 10,
  },
  filterButton: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 14,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  filterButtonActive: {
    borderColor: appTheme.accent,
    backgroundColor: appTheme.accentSoft,
    shadowOpacity: 0,
  },
  filterButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: appTheme.text,
  },
  filterButtonLabelActive: {
    color: appTheme.accentDeep,
  },
  activeFilterHint: {
    fontSize: 13,
    lineHeight: 18,
    color: appTheme.muted,
  },
  summaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  summaryLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: appTheme.muted,
  },
  summaryValue: {
    marginTop: 6,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    color: appTheme.text,
    letterSpacing: -0.5,
  },
  summaryMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: appTheme.muted,
  },
  saleCard: {
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  saleHeader: {
    backgroundColor: "transparent",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  saleHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  saleNo: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    color: appTheme.text,
    fontVariant: ["tabular-nums"],
  },
  saleRetailer: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: appTheme.text,
  },
  saleMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: appTheme.muted,
  },
  saleBody: {
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  amountLabel: {
    fontSize: 14,
    lineHeight: 18,
    color: appTheme.muted,
  },
  amountValue: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: appTheme.text,
  },
  highlightRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  highlightPending: {
    backgroundColor: appTheme.warningSoft,
  },
  highlightPaid: {
    backgroundColor: appTheme.successSoft,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: appTheme.border,
    borderRadius: 999,
    minHeight: 36,
    paddingHorizontal: 14,
    alignSelf: "flex-end",
    backgroundColor: appTheme.surface,
  },
  shareButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: appTheme.text,
  },
  highlightLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  highlightLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
  highlightValue: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(30, 43, 34, 0.45)",
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    maxHeight: "90%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: appTheme.border,
  },
  modalTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    color: appTheme.text,
    letterSpacing: -0.2,
  },
  modalScroll: {
    maxHeight: 460,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  modalSectionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: appTheme.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: -4,
  },
  retailerList: {
    gap: 8,
  },
  retailerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  retailerOptionText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: appTheme.text,
  },
  dateModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dateModeChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dateModeChipLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  dateRangeRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateRangeField: {
    flex: 1,
    minWidth: 0,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: appTheme.border,
  },
  modalActionButton: {
    flex: 1,
  },
});

function saleStatusLabel(status: RetailerSaleStatus, t: Translate) {
  switch (status) {
    case RetailerSaleStatus.SETTLED:
      return t("retailers.statusSettled");
    case RetailerSaleStatus.PARTIAL:
      return t("retailers.statusPartial");
    case RetailerSaleStatus.OPEN:
      return t("retailers.statusOpen");
    default:
      return status;
  }
}

function saleStatusTone(status: RetailerSaleStatus): "success" | "warning" | "neutral" {
  if (status === RetailerSaleStatus.SETTLED) return "success";
  if (status === RetailerSaleStatus.PARTIAL) return "warning";
  return "neutral";
}

function latestPaymentAt(sale: RetailerSaleRead) {
  if (sale.payments.length === 0) {
    return sale.created_at;
  }
  return sale.payments.reduce((latest, payment) => {
    return new Date(payment.paid_at).getTime() > new Date(latest).getTime() ? payment.paid_at : latest;
  }, sale.payments[0].paid_at);
}

const ShopSearchField = memo(function ShopSearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.searchField}>
      <MaterialCommunityIcons name="magnify" size={18} color={appTheme.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={appTheme.muted}
        style={styles.searchInput}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="search"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12} onPress={() => onChangeText("")}>
          <MaterialCommunityIcons name="close-circle" size={18} color={appTheme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

type SalesFilterModalProps = {
  visible: boolean;
  draft: RetailerSalesFilterDraft;
  retailers: RetailerRead[];
  retailersLoading: boolean;
  retailerSearch: string;
  calendarColors: CalendarPickerColors;
  t: Translate;
  onChangeRetailerSearch: (value: string) => void;
  onChangeDraft: (draft: RetailerSalesFilterDraft) => void;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
  onOpenCalendar: (target: "date" | "start" | "end") => void;
};

const SalesFilterModal = memo(function SalesFilterModal({
  visible,
  draft,
  retailers,
  retailersLoading,
  retailerSearch,
  calendarColors,
  t,
  onChangeRetailerSearch,
  onChangeDraft,
  onClose,
  onApply,
  onClear,
  onOpenCalendar,
}: SalesFilterModalProps) {
  const filteredRetailers = useMemo(() => {
    const query = retailerSearch.trim().toLowerCase();
    if (!query) {
      return retailers;
    }
    return retailers.filter((retailer) => retailer.name.toLowerCase().includes(query));
  }, [retailerSearch, retailers]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("retailers.filterSalesTitle")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close filters" hitSlop={12} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={appTheme.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalSectionLabel}>{t("retailers.filterRetailerSection")}</Text>
            <ShopSearchField
              value={retailerSearch}
              onChangeText={onChangeRetailerSearch}
              placeholder={t("retailers.searchRetailerNames")}
              accessibilityLabel={t("retailers.searchRetailerNames")}
            />
            <View style={styles.retailerList}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: draft.retailerId === null }}
                onPress={() => onChangeDraft({ ...draft, retailerId: null })}
                style={[
                  styles.retailerOption,
                  {
                    backgroundColor: draft.retailerId === null ? appTheme.accentSoft : appTheme.surface,
                    borderColor: draft.retailerId === null ? appTheme.accent : appTheme.border,
                  },
                ]}
              >
                <Text style={styles.retailerOptionText}>{t("retailers.allRetailers")}</Text>
                {draft.retailerId === null ? (
                  <MaterialCommunityIcons name="check-circle" size={18} color={appTheme.accent} />
                ) : null}
              </Pressable>
              {retailersLoading ? (
                <Text style={styles.summaryMeta}>{t("retailers.loadingRetailersList")}</Text>
              ) : (
                filteredRetailers.map((retailer) => {
                  const selected = draft.retailerId === retailer.id;
                  return (
                    <Pressable
                      key={retailer.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => onChangeDraft({ ...draft, retailerId: retailer.id })}
                      style={[
                        styles.retailerOption,
                        {
                          backgroundColor: selected ? appTheme.accentSoft : appTheme.surface,
                          borderColor: selected ? appTheme.accent : appTheme.border,
                        },
                      ]}
                    >
                      <Text style={styles.retailerOptionText} numberOfLines={1}>
                        {retailer.name}
                      </Text>
                      {selected ? <MaterialCommunityIcons name="check-circle" size={18} color={appTheme.accent} /> : null}
                    </Pressable>
                  );
                })
              )}
            </View>

            <Text style={styles.modalSectionLabel}>{t("retailers.filterDateSection")}</Text>
            <View style={styles.dateModeRow}>
              {DATE_MODE_OPTIONS.map((option) => {
                const active = draft.dateMode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => onChangeDraft({ ...draft, dateMode: option.key })}
                    style={[
                      styles.dateModeChip,
                      {
                        backgroundColor: active ? appTheme.accentSoft : appTheme.surface,
                        borderColor: active ? appTheme.accent : appTheme.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={option.icon}
                      size={14}
                      color={active ? appTheme.accentDeep : appTheme.muted}
                    />
                    <Text
                      style={[
                        styles.dateModeChipLabel,
                        { color: active ? appTheme.accentDeep : appTheme.text },
                      ]}
                    >
                      {t(option.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {draft.dateMode === "single" ? (
              <CalendarDateField
                label={t("retailers.saleDateLabel")}
                value={draft.date}
                colors={calendarColors}
                onPress={() => onOpenCalendar("date")}
              />
            ) : null}

            {draft.dateMode === "range" ? (
              <View style={styles.dateRangeRow}>
                <View style={styles.dateRangeField}>
                  <CalendarDateField
                    label={t("retailers.rangeFrom")}
                    value={draft.startDate}
                    colors={calendarColors}
                    icon="calendar-start"
                    onPress={() => onOpenCalendar("start")}
                  />
                </View>
                <View style={styles.dateRangeField}>
                  <CalendarDateField
                    label={t("retailers.rangeTo")}
                    value={draft.endDate}
                    colors={calendarColors}
                    icon="calendar-end"
                    onPress={() => onOpenCalendar("end")}
                  />
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.modalActions}>
            <View style={styles.modalActionButton}>
              <Button label={t("retailers.clearFilters")} variant="secondary" onPress={onClear} />
            </View>
            <View style={styles.modalActionButton}>
              <Button label={t("retailers.applyFilters")} onPress={onApply} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});

type SaleRowProps = {
  sale: RetailerSaleRead;
  tab: SalesTab;
  onPress: () => void;
  onShare: () => void;
  sharing: boolean;
  t: Translate;
};

const SaleRow = memo(function SaleRow({ sale, tab, onPress, onShare, sharing, t }: SaleRowProps) {
  const pending = tab === "pending";
  const paymentCount = sale.payments.length;

  return (
    <View style={styles.saleCard}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [pressed ? { opacity: 0.9 } : null]}
      >
        <View style={styles.saleHeader}>
          <View style={styles.saleHeaderText}>
            <Text style={styles.saleNo} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {formatRetailerSaleNoDisplay(sale.sale_no)}
            </Text>
            <Text style={styles.saleRetailer} numberOfLines={1}>
              {sale.retailer_name}
            </Text>
            <Text style={styles.saleMeta} numberOfLines={1}>
              {sale.shop_name}
            </Text>
            <Text style={styles.saleMeta}>{formatDateTime(sale.created_at)}</Text>
            {!pending && paymentCount > 0 ? (
              <Text style={styles.saleMeta}>
                {t("retailers.paymentsCount", { count: String(paymentCount) })} · {t("retailers.lastPayment")}{" "}
                {formatDateTime(latestPaymentAt(sale))}
              </Text>
            ) : null}
          </View>
          <StatusPill label={saleStatusLabel(sale.status, t)} tone={saleStatusTone(sale.status)} />
        </View>

        <View style={styles.saleBody}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t("billing.cartLiveTotal")}</Text>
            <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {formatCurrency(sale.total_amount)}
            </Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t("common.paidAmount")}</Text>
            <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {formatCurrency(sale.amount_paid_total)}
            </Text>
          </View>
          {pending ? (
            <View style={[styles.highlightRow, styles.highlightPending]}>
              <View style={styles.highlightLabelContainer}>
                <MaterialCommunityIcons name="clock-outline" size={16} color={appTheme.warning} />
                <Text style={[styles.highlightLabel, { color: appTheme.warning }]}>{t("retailers.balanceDue")}</Text>
              </View>
              <Text
                style={[styles.highlightValue, { color: appTheme.warning }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {formatCurrency(sale.balance_due)}
              </Text>
            </View>
          ) : (
            <View style={[styles.highlightRow, styles.highlightPaid]}>
              <View style={styles.highlightLabelContainer}>
                <MaterialCommunityIcons name="check-circle" size={16} color={appTheme.success} />
                <Text style={[styles.highlightLabel, { color: appTheme.success }]}>{t("retailers.fullySettled")}</Text>
              </View>
              <Text style={[styles.highlightValue, { color: appTheme.success }]}>
                {formatCurrency(sale.total_amount)}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("retailers.shareReceipt")}
          disabled={sharing}
          onPress={onShare}
          style={({ pressed }) => [
            styles.shareButton,
            { opacity: sharing ? 0.7 : pressed ? 0.88 : 1 },
          ]}
        >
          {sharing ? (
            <ActivityIndicator color={appTheme.text} size="small" />
          ) : (
            <MaterialCommunityIcons name="share-variant" size={16} color={appTheme.text} />
          )}
          <Text style={styles.shareButtonLabel}>
            {sharing ? t("retailers.shareReceiptPreparing") : t("retailers.shareReceipt")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

type SalesListHeaderProps = {
  tab: SalesTab;
  tabOptions: { key: SalesTab; label: string; count: number; icon?: string }[];
  onTabChange: (tab: SalesTab) => void;
  summaryTotal: string;
  summaryCount: number;
  hasSearchOrFilters: boolean;
  activeFilterLabel: string;
  searchQuery: string;
  filterActive: boolean;
  onSearchChange: (value: string) => void;
  onOpenFilter: () => void;
  t: Translate;
};

const SalesListHeader = memo(function SalesListHeader({
  tab,
  tabOptions,
  onTabChange,
  summaryTotal,
  summaryCount,
  hasSearchOrFilters,
  activeFilterLabel,
  searchQuery,
  filterActive,
  onSearchChange,
  onOpenFilter,
  t,
}: SalesListHeaderProps) {
  const pending = tab === "pending";

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      <ShopSegmentedTabs
        activeValue={tab}
        onChange={(val) => onTabChange(val as SalesTab)}
        items={tabOptions.map(opt => ({
          value: opt.key,
          label: `${opt.label} (${opt.count})`,
          icon: opt.icon as any,
        }))}
      />

      <View style={styles.searchFilterRow}>
        <ShopSearchField
          value={searchQuery}
          onChangeText={onSearchChange}
          placeholder={t("retailers.searchByRetailerName")}
          accessibilityLabel={t("retailers.searchByRetailerName")}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("retailers.filter")}
          onPress={onOpenFilter}
          style={[styles.filterButton, filterActive ? styles.filterButtonActive : null]}
        >
          <MaterialCommunityIcons
            name="filter-variant"
            size={18}
            color={filterActive ? appTheme.accentDeep : appTheme.text}
          />
          <Text style={[styles.filterButtonLabel, filterActive ? styles.filterButtonLabelActive : null]}>
            {t("retailers.filter")}
          </Text>
        </Pressable>
      </View>

      {hasSearchOrFilters && activeFilterLabel ? (
        <Text style={styles.activeFilterHint} numberOfLines={2}>
          {t("retailers.activeFilters")}: {activeFilterLabel}
        </Text>
      ) : null}

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          {pending ? t("retailers.pendingBalanceTotal") : t("retailers.paidSalesSummary")}
        </Text>
        <Text
          style={styles.summaryValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {formatCurrency(summaryTotal)}
        </Text>
        <Text style={styles.summaryMeta}>
          {hasSearchOrFilters
            ? t("retailers.matchingSalesCount", { count: String(summaryCount) })
            : pending
              ? t("retailers.pendingSalesCount", { count: String(summaryCount) })
              : t("retailers.paidSalesCount", { count: String(summaryCount) })}
        </Text>
      </View>
    </View>
  );
});

export function RetailerSalesScreen({ navigation }: RetailerSalesScreenProps) {
  const { language, t } = useShopTranslation();
  const { receiptImageShareBridge, startReceiptImageShare } = useReceiptImageShare();
  const [sharingSaleId, setSharingSaleId] = useState<string | null>(null);
  const [sales, setSales] = useState<RetailerSaleRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<SalesTab>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<RetailerSalesFilterDraft>(() => createRetailerSalesFilterDraft());
  const [draftFilter, setDraftFilter] = useState<RetailerSalesFilterDraft>(() => createRetailerSalesFilterDraft());
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [retailerSearch, setRetailerSearch] = useState("");
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [retailersLoading, setRetailersLoading] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<"date" | "start" | "end" | null>(null);

  const calendarColors = useMemo<CalendarPickerColors>(
    () => ({
      overlay: "rgba(30, 43, 34, 0.45)",
      card: appTheme.card,
      surface: appTheme.surface,
      border: appTheme.border,
      textPrimary: appTheme.text,
      textSecondary: appTheme.muted,
      textMuted: appTheme.muted,
      accent: appTheme.accent,
      accentSoft: appTheme.accentSoft,
      onAccent: "#FFFFFF",
    }),
    [],
  );

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      setSales(
        sortRetailerSalesByNo(
          (await fetchAllShopRetailerSales()).filter(
            (sale) => sale.status !== RetailerSaleStatus.VOID,
          ),
        ),
      );
    } catch (error) {
      Alert.alert(t("retailers.loadFailed"), formatApiErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  const salesRetailers = useMemo(() => mapRetailersFromSales(sales), [sales]);

  const loadRetailers = useCallback(async () => {
    setRetailersLoading(true);
    try {
      const rows = await fetchShopRetailers();
      const merged = [...rows, ...salesRetailers];
      const unique = new Map<string, RetailerRead>();
      for (const row of merged) {
        if (!unique.has(row.id)) {
          unique.set(row.id, row);
        }
      }
      setRetailers([...unique.values()].sort((left, right) => left.name.localeCompare(right.name)));
    } catch {
      setRetailers(salesRetailers);
    } finally {
      setRetailersLoading(false);
    }
  }, [salesRetailers]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load({ silent: true });
  }, [load]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: handleRefresh,
    refreshing: loading || refreshing,
  });

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!filterModalOpen) {
      return;
    }
    void loadRetailers();
  }, [filterModalOpen, loadRetailers]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  const pendingSales = useMemo(() => sales.filter(isPendingRetailerSale), [sales]);
  const paidSales = useMemo(() => sales.filter(isSettledRetailerSale), [sales]);
  const statusSales = tab === "pending" ? pendingSales : paidSales;

  const visibleSales = useMemo(
    () => statusSales.filter((sale) => saleMatchesRetailerSalesFilters(sale, appliedFilter, searchQuery)),
    [appliedFilter, searchQuery, statusSales],
  );

  const visibleTotal = useMemo(() => {
    const salesTotal = visibleSales.reduce(
      (sum, sale) => sum.plus(money(tab === "pending" ? sale.balance_due : sale.total_amount)),
      money(0),
    );
    if (tab !== "pending") {
      return salesTotal.toFixed(2);
    }
    const openingForVisible = (() => {
      if (appliedFilter.retailerId) {
        const retailer = retailers.find((row) => row.id === appliedFilter.retailerId);
        return money(retailer?.opening_balance ?? 0);
      }
      const ids = new Set(visibleSales.map((sale) => sale.retailer_id));
      return retailers
        .filter((retailer) => ids.has(retailer.id))
        .reduce((sum, retailer) => sum.plus(money(retailer.opening_balance ?? 0)), money(0));
    })();
    return salesTotal.plus(openingForVisible).toFixed(2);
  }, [appliedFilter.retailerId, retailers, tab, visibleSales]);

  const selectedRetailerName = useMemo(() => {
    if (!appliedFilter.retailerId) {
      return null;
    }
    return retailers.find((retailer) => retailer.id === appliedFilter.retailerId)?.name
      ?? sales.find((sale) => sale.retailer_id === appliedFilter.retailerId)?.retailer_name
      ?? null;
  }, [appliedFilter.retailerId, retailers, sales]);

  const activeFilterLabel = useMemo(
    () => describeRetailerSalesFilter(appliedFilter, selectedRetailerName),
    [appliedFilter, selectedRetailerName],
  );

  const hasSearchOrFilters = searchQuery.trim().length > 0 || hasActiveRetailerSalesFilters(appliedFilter);

  const tabOptions = useMemo(
    () => [
      { key: "pending" as const, label: t("retailers.tabPending"), count: pendingSales.length, icon: "clock-outline" },
      { key: "paid" as const, label: t("retailers.tabPaid"), count: paidSales.length, icon: "check-decagram-outline" },
    ],
    [paidSales.length, pendingSales.length, t],
  );

  const openFilterModal = useCallback(() => {
    setDraftFilter(appliedFilter);
    setRetailerSearch("");
    setFilterModalOpen(true);
  }, [appliedFilter]);

  const applyFilters = useCallback(() => {
    setAppliedFilter(draftFilter);
    setFilterModalOpen(false);
    setCalendarTarget(null);
  }, [draftFilter]);

  const clearFilters = useCallback(() => {
    const reset = createRetailerSalesFilterDraft();
    setDraftFilter(reset);
    setAppliedFilter(reset);
    setRetailerSearch("");
    setSearchQuery("");
    setCalendarTarget(null);
  }, []);

  const handleCalendarSelect = useCallback((date: string) => {
    setDraftFilter((current) => {
      if (calendarTarget === "date") {
        return { ...current, date };
      }
      if (calendarTarget === "start") {
        const endDate = current.endDate < date ? date : current.endDate;
        return { ...current, startDate: date, endDate };
      }
      if (calendarTarget === "end") {
        const startDate = current.startDate > date ? date : current.startDate;
        return { ...current, startDate, endDate: date };
      }
      return current;
    });
    setCalendarTarget(null);
  }, [calendarTarget]);

  const listHeader = useMemo(
    () => (
      <SalesListHeader
        tab={tab}
        tabOptions={tabOptions}
        onTabChange={setTab}
        summaryTotal={visibleTotal}
        summaryCount={visibleSales.length}
        hasSearchOrFilters={hasSearchOrFilters}
        activeFilterLabel={activeFilterLabel}
        searchQuery={searchQuery}
        filterActive={hasActiveRetailerSalesFilters(appliedFilter)}
        onSearchChange={setSearchQuery}
        onOpenFilter={openFilterModal}
        t={t}
      />
    ),
    [
      tab,
      tabOptions,
      visibleTotal,
      visibleSales.length,
      hasSearchOrFilters,
      activeFilterLabel,
      searchQuery,
      appliedFilter,
      openFilterModal,
      t,
    ],
  );

  const handleSalePress = useCallback(
    (saleId: string) => {
      navigation.navigate("RetailerSaleDetail", { saleId });
    },
    [navigation],
  );

  const shareSaleReceipt = useCallback(
    async (saleId: string, retailerId: string) => {
      setSharingSaleId(saleId);
      try {
        const [sale, outstandingBalance] = await Promise.all([
          fetchShopRetailerSale(saleId),
          fetchShopRetailerOutstandingBalance(retailerId),
        ]);
        if (!pickRetailerShareReceipt(sale)) {
          Alert.alert(t("retailers.shareReceiptFailed"), t("retailers.receiptUnavailable"));
          return;
        }
        await startReceiptImageShare(
          buildRetailerShareReceiptHtml(sale, outstandingBalance, language),
          `${t("retailers.shareReceipt")} ${sale.sale_no}`,
        );
      } catch (error) {
        Alert.alert(t("retailers.shareReceiptFailed"), formatApiErrorMessage(error));
      } finally {
        setSharingSaleId(null);
      }
    },
    [language, startReceiptImageShare, t],
  );

  if (loading && sales.length === 0) {
    return <LoadingState label={t("retailers.loadingSales")} />;
  }

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={visibleSales}
          keyExtractor={(item) => item.id}
          extraData={`${tab}-${searchQuery}-${activeFilterLabel}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#4B6356" />
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <EmptyState
              title={
                hasSearchOrFilters
                  ? t("retailers.salesEmptyFiltered")
                  : tab === "pending"
                    ? t("retailers.salesEmptyPending")
                    : t("retailers.salesEmptyPaid")
              }
              description={
                hasSearchOrFilters
                  ? t("retailers.salesEmptyFilteredHint")
                  : tab === "pending"
                    ? t("retailers.salesEmptyPendingHint")
                    : t("retailers.salesEmptyPaidHint")
              }
              actionLabel={hasSearchOrFilters ? t("retailers.clearFilters") : undefined}
              onAction={hasSearchOrFilters ? clearFilters : undefined}
            />
          }
          contentContainerStyle={{ paddingBottom: 24, flexGrow: visibleSales.length === 0 ? 1 : undefined }}
          renderItem={({ item }) => (
            <SaleRow
              sale={item}
              tab={tab}
              t={t}
              sharing={sharingSaleId === item.id}
              onPress={() => handleSalePress(item.id)}
              onShare={() => void shareSaleReceipt(item.id, item.retailer_id)}
            />
          )}
        />
      </Screen>

      <SalesFilterModal
        visible={filterModalOpen}
        draft={draftFilter}
        retailers={retailers}
        retailersLoading={retailersLoading}
        retailerSearch={retailerSearch}
        calendarColors={calendarColors}
        t={t}
        onChangeRetailerSearch={setRetailerSearch}
        onChangeDraft={setDraftFilter}
        onClose={() => {
          setFilterModalOpen(false);
          setCalendarTarget(null);
        }}
        onApply={applyFilters}
        onClear={clearFilters}
        onOpenCalendar={setCalendarTarget}
      />

      <CalendarDatePickerModal
        visible={calendarTarget !== null}
        title={
          calendarTarget === "start"
            ? t("retailers.rangeFrom")
            : calendarTarget === "end"
              ? t("retailers.rangeTo")
              : t("retailers.saleDateLabel")
        }
        value={
          calendarTarget === "date"
            ? draftFilter.date
            : calendarTarget === "start"
              ? draftFilter.startDate
              : draftFilter.endDate
        }
        rangeStartDate={draftFilter.startDate}
        rangeEndDate={draftFilter.endDate}
        colors={calendarColors}
        onSelect={handleCalendarSelect}
        onClose={() => setCalendarTarget(null)}
      />
      {receiptImageShareBridge}
    </View>
  );
}
