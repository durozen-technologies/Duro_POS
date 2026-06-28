import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/api/client";
import {
  createShopExpenseEntry,
  fetchCurrentShopExpenseItems,
  fetchShopExpenseHistory,
} from "@/api/expenses";
import { Button } from "@/components/ui/button";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { LoadingState } from "@/components/ui/loading-state";
import { TextField } from "@/components/ui/text-field";
import { ShopHeaderActions } from "@/components/shop-header";
import { useApiConnection } from "@/hooks/use-api-connection";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import type { ShopExpensesScreenProps } from "@/navigation/types";
import type { ExpenseEntryRead, ShopExpenseItemRead, UUID } from "@/types/api";
import {
  buildExpenseHistoryRange,
  createExpenseHistoryFilterDraft,
  EXPENSE_HISTORY_INTERVAL_OPTIONS,
  type ExpenseHistoryFilterDraft,
  type ExpenseHistoryRange,
} from "@/utils/expense-history-filters";
import { formatCurrency, formatDateTime } from "@/utils/format";
import { getItemThumbnailUri } from "@/utils/item-images";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

type CursorState = {
  sortOrder: number | null;
  name: string | null;
  id: UUID | null;
};
type HistoryCalendarTarget = "date" | "startDate" | "endDate";

const PAGE_LIMIT = 50;
const EMPTY_CURSOR: CursorState = { sortOrder: null, name: null, id: null };
const SHOP_CALENDAR_COLORS: CalendarPickerColors = {
  overlay: "rgba(30,43,34,0.38)",
  card: "#FFFFFF",
  surface: "#F7F3E8",
  border: "#D8E0D8",
  textPrimary: "#1E2B22",
  textSecondary: "#4B5C50",
  textMuted: "#64748B",
  accent: "#4F46E5",
  accentSoft: "#DDEEE6",
  onAccent: "#FFFFFF",
};

function pageCursor(page: {
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}): CursorState {
  return {
    sortOrder: page.next_cursor_sort_order ?? null,
    name: page.next_cursor_name ?? null,
    id: page.next_cursor_id ?? null,
  };
}

function mergeById<T extends { id: UUID }>(current: T[], nextRows: T[]) {
  const existingIds = new Set(current.map((row) => row.id));
  return [...current, ...nextRows.filter((row) => !existingIds.has(row.id))];
}

function isValidAmount(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return false;
  }
  return Number(trimmed) > 0;
}

function ExpenseRow({
  item,
  displayName,
  language,
  onPress,
}: {
  item: ShopExpenseItemRead;
  displayName: string;
  language: string;
  onPress: (item: ShopExpenseItemRead) => void;
}) {
  const tapToUpdateLabel = language === "en" ? "Tap to update amount" : "தொகையை புதுப்பிக்கத் தட்டவும்";
  const thumbnailUri = getItemThumbnailUri(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Update amount for ${displayName}`}
      onPress={() => onPress(item)}
      className="mb-3 rounded-card border border-border bg-card p-4 "
    >
      <View className="flex-row items-center gap-3">
        <ItemThumbnail
          uri={thumbnailUri}
          recyclingKey={item.id}
          size={48}
          borderRadius={15}
          backgroundColor="#DDEEE6"
          borderColor="#B9DCCB"
          icon="cash-minus"
          iconColor="#4F46E5"
          iconSize={22}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-base font-extrabold leading-6 text-ink" numberOfLines={1}>
            {displayName}
          </Text>
          <Text className="mt-0.5 text-sm font-semibold leading-5 text-muted" numberOfLines={1}>
            {item.tamil_name}
          </Text>
          <Text className="mt-1 text-xs font-semibold text-muted">
            {tapToUpdateLabel}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color="#64748B" />
      </View>
    </Pressable>
  );
}

function HistoryRow({ entry }: { entry: ExpenseEntryRead }) {
  return (
    <View className="mb-3 rounded-card border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-accentSoft">
          <MaterialCommunityIcons name="receipt-text-clock-outline" size={20} color="#4F46E5" />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-start gap-3">
            <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={1}>
              {entry.expense_name}
            </Text>
            <Text className="text-sm font-extrabold text-accent">
              {formatCurrency(entry.amount)}
            </Text>
          </View>
          <Text className="mt-0.5 text-xs font-semibold text-muted" numberOfLines={1}>
            {formatDateTime(entry.spent_at)}
          </Text>
          {entry.note ? (
            <Text className="mt-2 text-sm leading-5 text-muted" numberOfLines={2}>
              {entry.note}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ShopHistoryFilterControls({
  filter,
  range,
  totalAmount,
  onChange,
}: {
  filter: ExpenseHistoryFilterDraft;
  range: ExpenseHistoryRange;
  totalAmount: string;
  onChange: (filter: ExpenseHistoryFilterDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<HistoryCalendarTarget | null>(null);
  const selectedOption = EXPENSE_HISTORY_INTERVAL_OPTIONS.find((option) => option.key === filter.interval)
    ?? EXPENSE_HISTORY_INTERVAL_OPTIONS[0];
  const updateFilter = (patch: Partial<ExpenseHistoryFilterDraft>) => onChange({ ...filter, ...patch });
  const calendarValue =
    calendarTarget === "date"
      ? filter.date
      : calendarTarget === "startDate"
        ? filter.startDate
        : calendarTarget === "endDate"
          ? filter.endDate
          : null;
  const calendarTitle =
    calendarTarget === "date"
      ? "Select date"
      : calendarTarget === "startDate"
        ? "Select start date"
        : "Select end date";
  const selectCalendarDate = (date: string) => {
    if (calendarTarget === "date") {
      updateFilter({ date });
    } else if (calendarTarget === "startDate") {
      updateFilter({ startDate: date });
    } else if (calendarTarget === "endDate") {
      updateFilter({ endDate: date });
    }
    setCalendarTarget(null);
  };

  const inputForInterval = (() => {
    if (filter.interval === "date") {
      return (
        <CalendarDateField
          label="Date"
          value={filter.date}
          colors={SHOP_CALENDAR_COLORS}
          onPress={() => setCalendarTarget("date")}
        />
      );
    }
    if (filter.interval === "range") {
      return (
        <View className="flex-row flex-wrap gap-2">
          <CalendarDateField
            label="From"
            value={filter.startDate}
            colors={SHOP_CALENDAR_COLORS}
            icon="calendar-start"
            onPress={() => setCalendarTarget("startDate")}
          />
          <CalendarDateField
            label="To"
            value={filter.endDate}
            colors={SHOP_CALENDAR_COLORS}
            icon="calendar-end"
            onPress={() => setCalendarTarget("endDate")}
          />
        </View>
      );
    }
    if (filter.interval === "week") {
      return (
        <ShopHistoryInput
          label="Week date"
          value={filter.weekDate}
          placeholder="YYYY-MM-DD"
          onChangeText={(weekDate) => updateFilter({ weekDate })}
        />
      );
    }
    if (filter.interval === "month") {
      return (
        <ShopHistoryInput
          label="Month"
          value={filter.month}
          placeholder="YYYY-MM"
          onChangeText={(month) => updateFilter({ month })}
        />
      );
    }
    if (filter.interval === "year") {
      return (
        <ShopHistoryInput
          label="Year"
          value={filter.year}
          placeholder="YYYY"
          onChangeText={(year) => updateFilter({ year })}
        />
      );
    }
    return null;
  })();

  return (
    <View className="mb-3 gap-3 rounded-card border border-border bg-card p-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select history interval"
        onPress={() => setOpen(true)}
        className="min-h-[58px] flex-row items-center gap-2 rounded-control border border-border bg-background px-3"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[11px] font-black uppercase leading-4 text-muted">Interval</Text>
          <Text className="text-[15px] font-extrabold leading-5 text-ink" numberOfLines={1}>
            {selectedOption.label}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={selectedOption.icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
          size={20}
          color="#4F46E5"
        />
        <MaterialCommunityIcons name="chevron-down" size={22} color="#64748B" />
      </Pressable>

      {inputForInterval}

      <View className="min-h-[68px] flex-row items-center gap-3 rounded-control border border-accent bg-accentSoft p-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-extrabold leading-4 text-muted">
            Total for {range.isValid ? range.label : selectedOption.label}
          </Text>
          <Text className={range.isValid ? "mt-0.5 text-[11px] font-bold text-muted" : "mt-0.5 text-[11px] font-bold text-[#B42318]"}>
            {range.isValid ? "Filtered expense amount" : range.validationMessage}
          </Text>
        </View>
        <Text className="text-base font-black text-accent">{formatCurrency(totalAmount)}</Text>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.dropdownBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View className="max-h-[82%] w-full max-w-[520px] gap-2 rounded-card border border-border bg-card p-4">
            <View className="min-h-10 flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-lg font-extrabold text-ink">Select interval</Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} className="h-10 w-10 items-center justify-center">
                <MaterialCommunityIcons name="close" size={20} color="#1E2B22" />
              </Pressable>
            </View>
            {EXPENSE_HISTORY_INTERVAL_OPTIONS.map((option) => {
              const selected = option.key === filter.interval;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    updateFilter({ interval: option.key });
                    setOpen(false);
                  }}
                  className={`min-h-12 flex-row items-center gap-2 rounded-control border px-3 ${
                    selected ? "border-accent bg-accentSoft" : "border-border bg-background"
                  }`}
                >
                  <MaterialCommunityIcons
                    name={option.icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
                    size={18}
                    color={selected ? "#4F46E5" : "#64748B"}
                  />
                  <Text className="min-w-0 flex-1 text-sm font-extrabold text-ink" numberOfLines={1}>
                    {option.label}
                  </Text>
                  {selected ? <MaterialCommunityIcons name="check" size={18} color="#4F46E5" /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
      <CalendarDatePickerModal
        visible={calendarTarget !== null}
        title={calendarTitle}
        value={calendarValue}
        rangeStartDate={filter.interval === "range" ? filter.startDate : null}
        rangeEndDate={filter.interval === "range" ? filter.endDate : null}
        colors={SHOP_CALENDAR_COLORS}
        onSelect={selectCalendarDate}
        onClose={() => setCalendarTarget(null)}
      />
    </View>
  );
}

function ShopHistoryInput({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.historyInputWrap}>
      <Text className="text-[11px] font-black uppercase leading-4 text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        className="min-h-[46px] rounded-control border border-border bg-background px-3 text-sm font-bold text-ink"
      />
    </View>
  );
}

export function ShopExpensesScreen(_: ShopExpensesScreenProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ShopExpensesScreenProps["navigation"]>();
  const apiConnection = useApiConnection();
  const { language, t } = useShopTranslation();
  const clearSession = useAuthStore((state) => state.clearSession);
  const resetCart = useCartStore((state) => state.resetCart);
  const clearPrices = usePriceStore((state) => state.clear);
  const [items, setItems] = useState<ShopExpenseItemRead[]>([]);
  const [cursor, setCursor] = useState<CursorState>(EMPTY_CURSOR);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyRows, setHistoryRows] = useState<ExpenseEntryRead[]>([]);
  const [historyFilter, setHistoryFilter] = useState<ExpenseHistoryFilterDraft>(() => createExpenseHistoryFilterDraft());
  const historyRange = useMemo(() => buildExpenseHistoryRange(historyFilter), [historyFilter]);
  const [historyTotalAmount, setHistoryTotalAmount] = useState("0.00");
  const [historyCursor, setHistoryCursor] = useState<{ spentAt: string | null; id: UUID | null }>({
    spentAt: null,
    id: null,
  });

  const [selectedItem, setSelectedItem] = useState<ShopExpenseItemRead | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const visibleItems = useMemo(
    () => items.filter((item) => item.is_active && item.allocation_is_active),
    [items],
  );

  const handleLogout = useCallback(() => {
    clearSession();
    resetCart();
    clearPrices();
  }, [clearPrices, clearSession, resetCart]);

  const handleOpenInventory = useCallback(() => {
    navigation.navigate("InventoryManagement");
  }, [navigation]);

  const handleOpenPrinter = useCallback(() => {
    navigation.navigate("PrinterSetup");
  }, [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <ShopHeaderActions
          onLogout={handleLogout}
          onInventory={handleOpenInventory}
          onPrinter={handleOpenPrinter}
        />
      ),
    });
  }, [handleLogout, handleOpenInventory, handleOpenPrinter, navigation]);

  const loadItems = useCallback(async (refresh = false) => {
    setErrorMessage(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const page = await fetchCurrentShopExpenseItems({ limit: PAGE_LIMIT });
      setItems(page.items);
      setCursor(pageCursor(page));
      setHasMore(page.has_more);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to load expenses.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMoreItems = useCallback(async () => {
    if (!hasMore || loading || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchCurrentShopExpenseItems({
        limit: PAGE_LIMIT,
        cursor_sort_order: cursor.sortOrder,
        cursor_name: cursor.name,
        cursor_id: cursor.id,
      });
      setItems((current) => mergeById(current, page.items));
      setCursor(pageCursor(page));
      setHasMore(page.has_more);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to load more expenses.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loading, loadingMore]);

  const loadHistory = useCallback(async () => {
    if (!historyRange.isValid) {
      setHistoryRows([]);
      setHistoryHasMore(false);
      setHistoryTotalAmount("0.00");
      setHistoryCursor({ spentAt: null, id: null });
      setHistoryLoaded(true);
      return;
    }
    setHistoryLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchShopExpenseHistory({
        range_start_date: historyRange.rangeStartDate,
        range_end_date: historyRange.rangeEndDate,
        limit: 30,
      });
      setHistoryRows(page.items);
      setHistoryHasMore(page.has_more);
      setHistoryTotalAmount(page.total_amount);
      setHistoryCursor({
        spentAt: page.next_cursor_spent_at ?? null,
        id: page.next_cursor_id ?? null,
      });
      setHistoryLoaded(true);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to load expense history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyRange.isValid, historyRange.rangeEndDate, historyRange.rangeStartDate]);

  const loadMoreHistory = useCallback(async () => {
    if (!historyRange.isValid || !historyHasMore || historyLoading || historyLoadingMore) {
      return;
    }
    setHistoryLoadingMore(true);
    try {
      const page = await fetchShopExpenseHistory({
        range_start_date: historyRange.rangeStartDate,
        range_end_date: historyRange.rangeEndDate,
        limit: 30,
        cursor_spent_at: historyCursor.spentAt,
        cursor_id: historyCursor.id,
      });
      setHistoryRows((current) => mergeById(current, page.items));
      setHistoryHasMore(page.has_more);
      setHistoryTotalAmount(page.total_amount);
      setHistoryCursor({
        spentAt: page.next_cursor_spent_at ?? null,
        id: page.next_cursor_id ?? null,
      });
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to load more expense history.");
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [
    historyCursor,
    historyHasMore,
    historyLoading,
    historyLoadingMore,
    historyRange.isValid,
    historyRange.rangeEndDate,
    historyRange.rangeStartDate,
  ]);

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems]),
  );

  useEffect(() => {
    if (historyOpen) {
      void loadHistory();
    }
  }, [historyOpen, loadHistory]);

  const openExpenseModal = useCallback((item: ShopExpenseItemRead) => {
    setSelectedItem(item);
    setAmountDraft("");
  }, []);

  const closeExpenseModal = useCallback(() => {
    if (saving) {
      return;
    }
    setSelectedItem(null);
  }, [saving]);

  const submitExpense = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    if (!isValidAmount(amountDraft)) {
      Alert.alert("Invalid amount", "Enter a valid rupee amount with up to 2 decimals.");
      return;
    }
    setSaving(true);
    try {
      await createShopExpenseEntry({
        expense_item_id: selectedItem.id,
        amount: Number(amountDraft).toFixed(2),
        note: null,
      });
      setSelectedItem(null);
      if (historyLoaded) {
        await loadHistory();
      }
    } catch (error) {
      Alert.alert("Save failed", toApiError(error).message || "Unable to record expense.");
    } finally {
      setSaving(false);
    }
  }, [amountDraft, historyLoaded, loadHistory, selectedItem]);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((current) => !current);
  }, []);

  const renderListHeader = () => (
    <View className="mb-4 gap-4">
      {errorMessage ? (
        <View className="flex-row items-center gap-2 rounded-card border border-[#B42318] bg-[#FEE4E2] px-4 py-3">
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#B42318" />
          <Text className="min-w-0 flex-1 text-sm font-semibold text-[#B42318]">{errorMessage}</Text>
        </View>
      ) : null}
      {apiConnection.status === "offline" ? (
        <View className="flex-row items-center gap-2 rounded-card border border-[#B42318] bg-[#FEE4E2] px-4 py-3">
          <MaterialCommunityIcons name="database-alert-outline" size={18} color="#B42318" />
          <Text className="min-w-0 flex-1 text-sm font-semibold text-[#B42318]">
            Backend offline at {apiConnection.baseUrl || "configured API URL"}. {apiConnection.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={apiConnection.checking}
            onPress={() => void apiConnection.retry()}
            hitSlop={10}
          >
            <Text className="text-xs font-extrabold text-[#B42318]">
              {apiConnection.checking ? "Checking" : "Retry"}
            </Text>
          </Pressable>
        </View>
      ) : null}



      <Text className="text-base font-extrabold text-ink">Allocated expense items</Text>
    </View>
  );

  const renderListFooter = () => (
    <View className="gap-4 pt-2">
      {loadingMore ? <ActivityIndicator color="#4F46E5" style={styles.footerLoader} /> : null}
      <Button
        label={historyOpen ? "Hide history" : "History"}
        onPress={toggleHistory}
        variant="secondary"
      />
      {historyOpen ? (
        <View>
          <Text className="mb-3 text-base font-extrabold text-ink">Recent history</Text>
          <ShopHistoryFilterControls
            filter={historyFilter}
            range={historyRange}
            totalAmount={historyTotalAmount}
            onChange={setHistoryFilter}
          />
          {historyLoading && historyRows.length === 0 ? (
            <ActivityIndicator color="#4F46E5" />
          ) : historyRows.length === 0 ? (
            <EmptyState title="No expense history" description="Recorded expense entries will show here." />
          ) : (
            <>
              {historyRows.map((entry) => <HistoryRow key={entry.id} entry={entry} />)}
              {historyHasMore ? (
                <Button
                  label={historyLoadingMore ? "Loading..." : "Load more history"}
                  onPress={loadMoreHistory}
                  loading={historyLoadingMore}
                  variant="secondary"
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );

  if (loading && items.length === 0) {
    return <LoadingState fullscreen label="Loading expenses..." />;
  }

  return (
    <SafeAreaView edges={["left", "right"]} className="flex-1 bg-background">
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ExpenseRow
            item={item}
            displayName={getLocalizedItemName(language, item.name, item.tamil_name)}
            language={language}
            onPress={openExpenseModal}
          />
        )}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          <EmptyState
            title="No expense items"
            description="Ask an admin to allocate expense items to this branch."
          />
        }
        ListFooterComponent={renderListFooter}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadItems(true)} tintColor="#4F46E5" />}
        onEndReached={loadMoreItems}
        onEndReachedThreshold={0.45}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 112 + insets.bottom,
        }}
      /> 

      <View className="px-4 pb-4 pt-2">
        <Button
          label={t("action.backToBilling")}
          onPress={() => navigation.navigate("Billing")}
          variant="secondary"
          className="w-full"
        />
      </View>

      <Modal visible={Boolean(selectedItem)} animationType="slide" transparent onRequestClose={closeExpenseModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalBackdrop}
        >
          <View className="rounded-t-[26px] border border-border bg-card p-5">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingBottom: 12 }}
            >
              <Text className="text-lg font-extrabold text-ink" numberOfLines={1}>
                {selectedItem ? getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name) : "Expense"}
              </Text>
              <Text className="mt-1 text-sm font-semibold text-muted" numberOfLines={1}>
                {selectedItem?.tamil_name}
              </Text>

              <TextField
                label="Amount in rupees"
                value={amountDraft}
                onChangeText={setAmountDraft}
                keyboardType="decimal-pad"
                placeholder="Example 250.00"
                autoFocus
              />
            </ScrollView>

            <View className="mt-5 flex-row gap-3">
              <Button
                label="Cancel"
                variant="secondary"
                onPress={closeExpenseModal}
                disabled={saving}
                className="flex-1"
              />
              <Button
                label={language === "en" ? "Update amount" : "தொகையை புதுப்பி"}
                onPress={submitExpense}
                loading={saving}
                className="flex-1"
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  footerLoader: {
    paddingVertical: 18,
  },
  dropdownBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(30,43,34,0.38)",
  },
  historyInputWrap: {
    flex: 1,
    minWidth: 138,
    gap: 5,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(30,43,34,0.38)",
  },
});
