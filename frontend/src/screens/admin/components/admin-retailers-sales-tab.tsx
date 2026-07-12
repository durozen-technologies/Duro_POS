import { MaterialCommunityIcons } from "@expo/vector-icons";

import { useFocusEffect } from "@react-navigation/native";

import { memo, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";

import {

  Alert,

  FlatList,

  Modal,

  Pressable,

  RefreshControl,

  ScrollView,

  StyleSheet,

  Text,

  View,

} from "react-native";



import { fetchAllAdminRetailerSales, fetchAllRetailers, cancelAdminRetailerSale } from "@/api/retailers";

import { formatApiErrorMessage } from "@/api/client";

import {

  CalendarDateField,

  CalendarDatePickerModal,

  type CalendarPickerColors,

} from "@/components/ui/calendar-date-picker";

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

import {

  formatRetailerSaleNoDisplay,

  isPendingRetailerSale,

  isSettledRetailerSale,

  sortRetailerSalesByNo,

} from "@/utils/retailer-sale";



import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";

import { triggerHaptic } from "../admin-dashboard-utils";

import { AdminSegmentedTabs } from "./admin-design-system";

import {

  ActionButton,

  ChipButton,

  EmptyStateCard,

  PrimaryButton,

  SearchField,

} from "./admin-dashboard-primitives";

import { AdminRetailerSaleActionRow } from "./admin-retailer-sale-action-row";

import { AdminRetailerSaleEditModal } from "./admin-retailer-sale-edit-modal";



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

  onEdit: () => void;

  onCancel: () => void;

};



type SalesFilterModalProps = {

  visible: boolean;

  palette: ThemePalette;

  draft: RetailerSalesFilterDraft;

  retailers: RetailerRead[];

  retailersLoading: boolean;

  retailerSearch: string;

  calendarColors: CalendarPickerColors;

  onChangeRetailerSearch: (value: string) => void;

  onChangeDraft: (draft: RetailerSalesFilterDraft) => void;

  onClose: () => void;

  onApply: () => void;

  onClear: () => void;

  onOpenCalendar: (target: "date" | "start" | "end") => void;

};



const DATE_MODE_OPTIONS: { key: RetailerSalesDateMode; label: string; icon: ComponentProps<typeof MaterialCommunityIcons>["name"] }[] = [

  { key: "all", label: "All dates", icon: "calendar-blank-outline" },

  { key: "single", label: "Date", icon: "calendar" },

  { key: "range", label: "Range", icon: "calendar-range" },

];



const SalesFilterModal = memo(function SalesFilterModal({

  visible,

  palette,

  draft,

  retailers,

  retailersLoading,

  retailerSearch,

  calendarColors,

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

      <View style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}>

        <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>

          <View style={styles.modalHeader}>

            <Text style={[adminTypography.section, { color: palette.textPrimary }]}>Filter sales</Text>

            <Pressable accessibilityRole="button" accessibilityLabel="Close filters" hitSlop={12} onPress={onClose}>

              <MaterialCommunityIcons name="close" size={22} color={palette.textSecondary} />

            </Pressable>

          </View>



          <ScrollView

            style={styles.modalScroll}

            contentContainerStyle={styles.modalScrollContent}

            keyboardShouldPersistTaps="handled"

            showsVerticalScrollIndicator={false}

          >

            <Text style={[adminTypography.caption, styles.modalSectionLabel, { color: palette.textMuted }]}>

              Retailer

            </Text>

            <SearchField

              value={retailerSearch}

              onChangeText={onChangeRetailerSearch}

              placeholder="Search retailer names"

              palette={palette}

              accessibilityLabel="Search retailer names in filter"

            />

            <View style={styles.retailerList}>

              <Pressable

                accessibilityRole="button"

                accessibilityState={{ selected: draft.retailerId === null }}

                onPress={() => onChangeDraft({ ...draft, retailerId: null })}

                style={[

                  styles.retailerOption,

                  {

                    backgroundColor: draft.retailerId === null ? palette.primarySoft : palette.surfaceMuted,

                    borderColor: draft.retailerId === null ? palette.primary : palette.border,

                  },

                ]}

              >

                <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>All retailers</Text>

                {draft.retailerId === null ? (

                  <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} />

                ) : null}

              </Pressable>

              {retailersLoading ? (

                <Text style={[adminTypography.caption, { color: palette.textMuted, paddingVertical: adminSpacing.sm }]}>

                  Loading retailers…

                </Text>

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

                          backgroundColor: selected ? palette.primarySoft : palette.surfaceMuted,

                          borderColor: selected ? palette.primary : palette.border,

                        },

                      ]}

                    >

                      <Text style={[adminTypography.body, { color: palette.textPrimary }]} numberOfLines={1}>

                        {retailer.name}

                      </Text>

                      {selected ? <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} /> : null}

                    </Pressable>

                  );

                })

              )}

            </View>



            <Text style={[adminTypography.caption, styles.modalSectionLabel, { color: palette.textMuted }]}>

              Sale date

            </Text>

            <View style={styles.dateModeRow}>

              {DATE_MODE_OPTIONS.map((option) => {

                const active = draft.dateMode === option.key;

                return (

                  <ChipButton

                    key={option.key}

                    label={option.label}

                    icon={option.icon}

                    active={active}

                    palette={palette}

                    onPress={() => onChangeDraft({ ...draft, dateMode: option.key })}

                  />

                );

              })}

            </View>



            {draft.dateMode === "single" ? (

              <CalendarDateField

                label="Sale date"

                value={draft.date}

                colors={calendarColors}

                onPress={() => onOpenCalendar("date")}

              />

            ) : null}



            {draft.dateMode === "range" ? (

              <View style={styles.dateRangeRow}>

                <View style={styles.dateRangeField}>

                  <CalendarDateField

                    label="From"

                    value={draft.startDate}

                    colors={calendarColors}

                    icon="calendar-start"

                    onPress={() => onOpenCalendar("start")}

                  />

                </View>

                <View style={styles.dateRangeField}>

                  <CalendarDateField

                    label="To"

                    value={draft.endDate}

                    colors={calendarColors}

                    icon="calendar-end"

                    onPress={() => onOpenCalendar("end")}

                  />

                </View>

              </View>

            ) : null}

          </ScrollView>



          <View style={[styles.modalActions, { borderTopColor: palette.border }]}>

            <PrimaryButton

              label="Clear"

              variant="secondary"

              palette={palette}

              onPress={onClear}

            />

            <PrimaryButton

              label="Apply filters"

              variant="primary"

              palette={palette}

              onPress={onApply}

            />

          </View>

        </View>

      </View>

    </Modal>

  );

});



const SaleRow = memo(function SaleRow({ sale, filter, palette, onPress, onEdit, onCancel }: SaleRowProps) {
  const pending = filter === "pending";

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
        style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
      >
      <View style={[styles.saleHeader, { borderBottomColor: palette.border, backgroundColor: 'transparent' }]}>
        <View style={styles.saleHeaderText}>
          <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary, fontSize: 16 }]} numberOfLines={1}>
            {formatRetailerSaleNoDisplay(sale.sale_no)}
          </Text>
          <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary, marginTop: 4 }]} numberOfLines={1}>
            {sale.retailer_name}
          </Text>
          <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
            {sale.shop_name}
          </Text>
          <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 2 }]}>
            {formatDateTime(sale.created_at)}
          </Text>
        </View>
      </View>
      
      <View style={styles.saleBody}>
        <View style={styles.amountRow}>
          <Text style={[adminTypography.body, { color: palette.textMuted }]}>Total Amount</Text>
          <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>{formatCurrency(sale.total_amount)}</Text>
        </View>
        <View style={styles.amountRow}>
          <Text style={[adminTypography.body, { color: palette.textMuted }]}>Paid Amount</Text>
          <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>{formatCurrency(sale.amount_paid_total)}</Text>
        </View>

        {pending ? (
          <View style={[styles.highlightRow, { backgroundColor: palette.warningSoft }]}>
            <View style={styles.highlightLabelContainer}>
              <MaterialCommunityIcons name="clock-outline" size={16} color={palette.warning} />
              <Text style={[adminTypography.bodyStrong, { color: palette.warning }]}>Balance Due</Text>
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
              <Text style={[adminTypography.bodyStrong, { color: palette.success }]}>Fully Settled</Text>
            </View>
            <Text style={[adminTypography.bodyStrong, { color: palette.success, fontSize: 16 }]}>
              {formatCurrency(sale.total_amount)}
            </Text>
          </View>
        )}
      </View>
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

  const [searchQuery, setSearchQuery] = useState("");

  const [appliedFilter, setAppliedFilter] = useState<RetailerSalesFilterDraft>(() => createRetailerSalesFilterDraft());

  const [draftFilter, setDraftFilter] = useState<RetailerSalesFilterDraft>(() => createRetailerSalesFilterDraft());

  const [filterModalOpen, setFilterModalOpen] = useState(false);

  const [retailerSearch, setRetailerSearch] = useState("");

  const [retailers, setRetailers] = useState<RetailerRead[]>([]);

  const [retailersLoading, setRetailersLoading] = useState(false);

  const [calendarTarget, setCalendarTarget] = useState<"date" | "start" | "end" | null>(null);

  const [editSale, setEditSale] = useState<RetailerSaleRead | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);



  const calendarColors = useMemo<CalendarPickerColors>(

    () => ({

      overlay: palette.overlay,

      card: palette.card,

      surface: palette.surfaceMuted,

      border: palette.border,

      textPrimary: palette.textPrimary,

      textSecondary: palette.textSecondary,

      textMuted: palette.textMuted,

      accent: palette.primary,

      accentSoft: palette.primarySoft,

      onAccent: palette.onPrimary,

    }),

    [palette],

  );



  const load = useCallback(async (isRefresh = false) => {

    if (isRefresh) setRefreshing(true);

    else setLoading(true);

    try {

      const rows = sortRetailerSalesByNo(

        (await fetchAllAdminRetailerSales()).filter(
          (sale) =>
            sale.status !== RetailerSaleStatus.VOID &&
            sale.status !== RetailerSaleStatus.CANCELLED,
        ),

      );

      setSales(rows);

      setError(null);

    } catch (err) {

      setError(formatApiErrorMessage(err));

    } finally {

      setLoading(false);

      setRefreshing(false);

      if (isRefresh) {

        onRefreshComplete?.();

      }

    }

  }, [onRefreshComplete]);



  const loadRetailers = useCallback(async () => {

    setRetailersLoading(true);

    try {

      const rows = await fetchAllRetailers();

      setRetailers(rows.sort((left, right) => left.name.localeCompare(right.name)));

    } catch {

      setRetailers([]);

    } finally {

      setRetailersLoading(false);

    }

  }, []);



  useFocusEffect(useCallback(() => { void load(); }, [load]));



  useEffect(() => {

    if (refreshNonce > 0) {

      void load(true);

    }

  }, [load, refreshNonce]);



  useEffect(() => {

    if (!filterModalOpen) {

      return;

    }

    void loadRetailers();

  }, [filterModalOpen, loadRetailers]);



  const handleCancelSale = useCallback((sale: RetailerSaleRead) => {
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
  }, [load]);

  const handleSaleSaved = useCallback(
    (updated: RetailerSaleRead) => {
      setSales((current) =>
        sortRetailerSalesByNo(
          current.map((row) => (row.id === updated.id ? updated : row)),
        ),
      );
    },
    [],
  );

  const pendingSales = useMemo(() => sales.filter(isPendingRetailerSale), [sales]);

  const paidSales = useMemo(() => sales.filter(isSettledRetailerSale), [sales]);

  const statusSales = filter === "pending" ? pendingSales : paidSales;



  const visibleSales = useMemo(

    () => statusSales.filter((sale) => saleMatchesRetailerSalesFilters(sale, appliedFilter, searchQuery)),

    [appliedFilter, searchQuery, statusSales],

  );



  const visibleTotal = useMemo(

    () => visibleSales

      .reduce(

        (sum, sale) => sum.plus(money(filter === "pending" ? sale.balance_due : sale.total_amount)),

        money(0),

      )

      .toFixed(2),

    [filter, visibleSales],

  );



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



  const filterTabs = useMemo(

    () => [

      { value: "pending" as const, label: `Pending (${pendingSales.length})`, icon: "clock-outline" as const },

      { value: "paid" as const, label: `Paid (${paidSales.length})`, icon: "check-decagram-outline" as const },

    ],

    [paidSales.length, pendingSales.length],

  );



  const openFilterModal = useCallback(() => {

    triggerHaptic();

    setDraftFilter(appliedFilter);

    setRetailerSearch("");

    setFilterModalOpen(true);

  }, [appliedFilter]);



  const applyFilters = useCallback(() => {

    triggerHaptic();

    setAppliedFilter(draftFilter);

    setFilterModalOpen(false);

    setCalendarTarget(null);

  }, [draftFilter]);



  const clearFilters = useCallback(() => {

    triggerHaptic();

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



      <View style={styles.searchFilterRow}>

        <View style={styles.searchFieldWrap}>

          <SearchField

            value={searchQuery}

            onChangeText={setSearchQuery}

            placeholder="Search by retailer name"

            palette={palette}

            accessibilityLabel="Search retailer sales by retailer name"

          />

        </View>

        <ActionButton

          label="Filter"

          icon="filter-variant"

          palette={palette}

          tone="info"

          active={hasActiveRetailerSalesFilters(appliedFilter)}

          onPress={openFilterModal}

        />

      </View>



      {hasSearchOrFilters && activeFilterLabel ? (

        <Text style={[adminTypography.caption, styles.activeFilterHint, { color: palette.textMuted }]} numberOfLines={2}>

          Filters: {activeFilterLabel}

        </Text>

      ) : null}



      <View style={[styles.summaryCard, { backgroundColor: palette.surfaceMuted }]}>

        <Text style={[adminTypography.caption, { color: palette.textMuted, fontWeight: "700" }]}>

          {filter === "pending" ? "Total balance due" : "Total settled"}

        </Text>

        <Text style={[styles.summaryValue, { color: palette.textPrimary }]} numberOfLines={1}>

          {formatCurrency(visibleTotal)}

        </Text>

        <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]}>

          {hasSearchOrFilters

            ? `${visibleSales.length} matching sale(s)`

            : filter === "pending"

              ? `${pendingSales.length} open or partial sale(s)`

              : `${paidSales.length} fully paid sale(s)`}

        </Text>

      </View>



      <FlatList

        style={{ flex: 1 }}

        data={visibleSales}

        keyExtractor={(item) => item.id}

        extraData={`${filter}-${searchQuery}-${activeFilterLabel}`}

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

            title={

              hasSearchOrFilters

                ? "No matching sales"

                : filter === "pending"

                  ? "No pending sales"

                  : "No fully paid sales"

            }

            subtitle={

              hasSearchOrFilters

                ? "Try a different retailer name or adjust the date filters."

                : filter === "pending"

                  ? "Open and partial retailer sales will appear here."

                  : "Settled retailer sales will appear here after full payment."

            }

            palette={palette}

            icon="receipt-text-outline"

            actionLabel={hasSearchOrFilters ? "Clear filters" : undefined}

            onAction={hasSearchOrFilters ? clearFilters : undefined}

          />

        }

        renderItem={({ item }) => (

          <SaleRow

            sale={item}

            filter={filter}

            palette={palette}

            onPress={() => onOpenSale(item.id)}

            onEdit={() => {
              setEditSale(item);
              setEditModalOpen(true);
            }}

            onCancel={() => handleCancelSale(item)}

          />

        )}

      />



      <SalesFilterModal

        visible={filterModalOpen}

        palette={palette}

        draft={draftFilter}

        retailers={retailers}

        retailersLoading={retailersLoading}

        retailerSearch={retailerSearch}

        calendarColors={calendarColors}

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

            ? "Range start"

            : calendarTarget === "end"

              ? "Range end"

              : "Sale date"

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

  searchFilterRow: {

    flexDirection: "row",

    alignItems: "center",

    gap: adminSpacing.sm,

    paddingHorizontal: adminSpacing.md,

    paddingTop: adminSpacing.sm,

  },

  searchFieldWrap: {

    flex: 1,

    minWidth: 0,

  },

  activeFilterHint: {

    paddingHorizontal: adminSpacing.md,

    paddingTop: adminSpacing.xs,

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

  },  saleCard: {
    marginBottom: adminSpacing.md,
    marginHorizontal: adminSpacing.md,
    borderRadius: adminRadii.card,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  saleHeader: {
    paddingHorizontal: adminSpacing.md,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  saleHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  saleBody: {
    gap: 10,
    paddingHorizontal: adminSpacing.md,
    paddingBottom: adminSpacing.md,
    paddingTop: 4,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
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
  highlightLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  modalOverlay: {

    flex: 1,

    justifyContent: "center",

    padding: adminSpacing.md,

  },

  modalCard: {

    borderRadius: adminRadii.card,

    borderWidth: StyleSheet.hairlineWidth,

    maxHeight: "88%",

    overflow: "hidden",

  },

  modalHeader: {

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    paddingHorizontal: adminSpacing.md,

    paddingTop: adminSpacing.md,

    paddingBottom: adminSpacing.sm,

  },

  modalScroll: {

    maxHeight: 420,

  },

  modalScrollContent: {

    paddingHorizontal: adminSpacing.md,

    paddingBottom: adminSpacing.sm,

    gap: adminSpacing.sm,

  },

  modalSectionLabel: {

    fontWeight: "700",

    marginTop: adminSpacing.xs,

  },

  retailerList: {

    gap: adminSpacing.xs,

  },

  retailerOption: {

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    gap: adminSpacing.sm,

    borderWidth: StyleSheet.hairlineWidth,

    borderRadius: adminRadii.control,

    paddingHorizontal: adminSpacing.sm,

    paddingVertical: adminSpacing.sm,

  },

  dateModeRow: {

    flexDirection: "row",

    flexWrap: "wrap",

    gap: adminSpacing.xs,

  },

  dateRangeRow: {

    flexDirection: "row",

    gap: adminSpacing.sm,

  },

  dateRangeField: {

    flex: 1,

    minWidth: 0,

  },

  modalActions: {

    flexDirection: "row",

    gap: adminSpacing.sm,

    padding: adminSpacing.md,

    borderTopWidth: StyleSheet.hairlineWidth,

    borderTopColor: "transparent",

  },

});


