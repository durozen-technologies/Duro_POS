import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollView as ScrollViewType,
} from "react-native";

import {
  addShopInventoryStock,
  fetchShopInventoryBackdatePolicy,
  fetchShopInventoryRows,
  fetchShopInventoryMovements,
  fetchShopInventoryTransfers,
  useShopInventoryStock,
  useShopInventoryStockSplit,
  getActiveTransferShops,
  transferInventoryStock,
} from "@/api/inventory";
import { toApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { TextField } from "@/components/ui/text-field";
import { TransferShopPicker } from "./components/transfer-shop-picker";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import {
  BaseUnit,
  InventoryMovementType,
  type InventoryBackdatePolicyRead,
  type InventoryItemStockRead,
  type InventoryMovementRead,
  type InventoryTransferRead,
  type UUID,
  type TransferShopRead,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { toDateInputValue } from "@/utils/expense-history-filters";
import { formatDateTime } from "@/utils/format";
import { getItemThumbnailUri } from "@/utils/item-images";
import type { InventoryManagementScreenProps } from "@/navigation/types";

type MovementMode = InventoryMovementType.ADD | InventoryMovementType.USE | "TRANSFER";
type MovementHistoryMode = "date" | "range";
type MovementHistoryCalendarTarget = "date" | "start" | "end";
type MovementHistoryTab = "movements" | "transfers";
type MovementHistoryParams = {
  reference_date: string | null;
  range_start_date: string | null;
  range_end_date: string | null;
};
type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];
const HISTORY_BUTTON_GREEN = "#0F7642";
const SHOP_INVENTORY_PAGE_SIZE = 50;

function buildOccurredAtPayload(dateValue: string, timeValue: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  const hours = match ? match[1] : "00";
  const minutes = match ? match[2] : "00";
  const parsed = new Date(`${dateValue}T${hours}:${minutes}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function currentTimeDraft() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function movementRecordedLabel(occurredAt: string, createdAt: string) {
  const delta = Math.abs(new Date(createdAt).getTime() - new Date(occurredAt).getTime());
  if (delta <= 60_000) {
    return null;
  }
  return `Recorded ${formatDateTime(createdAt)}`;
}

type InventoryCursor = {
  sortOrder: number | null;
  name: string | null;
  id: UUID | null;
};

const EMPTY_INVENTORY_CURSOR: InventoryCursor = {
  sortOrder: null,
  name: null,
  id: null,
};

function formatQuantity(value: string | number, unit?: BaseUnit) {
  const numeric = money(value).toNumber();
  const display = unit === BaseUnit.UNIT && Number.isInteger(numeric)
    ? `${numeric}`
    : numeric.toFixed(unit === BaseUnit.UNIT ? 0 : 3).replace(/\.?0+$/, "");
  if (!unit) {
    return display || "0";
  }
  return `${display || "0"} ${unit === BaseUnit.KG ? "kg" : numeric === 1 ? "unit" : "units"}`;
}

function isWholeQuantity(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric);
}

function parseQuantityDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return money(0);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  return money(trimmed);
}

function isWholeDecimalValue(value: ReturnType<typeof money>) {
  return value.equals(value.toDecimalPlaces(0));
}

function patchInventoryRow(
  currentItems: InventoryItemStockRead[],
  changedItem: InventoryItemStockRead,
) {
  return currentItems.map((item) => (item.id === changedItem.id ? changedItem : item));
}

function visibleStockRows(items: InventoryItemStockRead[]) {
  return items
    .filter((item) => item.is_active && item.allocation_active)
    .sort((left, right) => left.allocation_sort_order - right.allocation_sort_order || left.name.localeCompare(right.name));
}

export function InventoryManagementScreen(_: InventoryManagementScreenProps) {
  const navigation = useNavigation<InventoryManagementScreenProps["navigation"]>();
  const { language, t } = useShopTranslation();
  const [items, setItems] = useState<InventoryItemStockRead[]>([]);
  const [transferShops, setTransferShops] = useState<TransferShopRead[]>([]);
  const [shopName, setShopName] = useState<string | null>(null);
  const [inventoryCursor, setInventoryCursor] = useState<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const [inventoryHasMore, setInventoryHasMore] = useState(false);
  const [inventoryLoadingMore, setInventoryLoadingMore] = useState(false);
  const [movements, setMovements] = useState<InventoryMovementRead[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransferRead[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsLoadedKey, setMovementsLoadedKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<MovementHistoryTab>("movements");
  const [historyMode, setHistoryMode] = useState<MovementHistoryMode>("date");
  const [historyDate, setHistoryDate] = useState(() => toDateInputValue(new Date()));
  const [historyRangeStart, setHistoryRangeStart] = useState(() => toDateInputValue(new Date()));
  const [historyRangeEnd, setHistoryRangeEnd] = useState(() => toDateInputValue(new Date()));
  const [historyCalendarTarget, setHistoryCalendarTarget] = useState<MovementHistoryCalendarTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItemStockRead | null>(null);
  const [mode, setMode] = useState<MovementMode>(InventoryMovementType.ADD);
  const [transferShopId, setTransferShopId] = useState<UUID | null>(null);
  const [quantity, setQuantity] = useState("");
  const [driverName, setDriverName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const movementScrollRef = useRef<ScrollViewType>(null);
  const movementScrollOffsetRef = useRef(0);
  const movementQuantityFieldRef = useRef<View | null>(null);
  const movementCategoryFieldRefs = useRef<Record<UUID, View | null>>({});
  const movementActiveFieldRef = useRef<View | null>(null);
  const keyboardInsetRef = useRef(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [categoryQuantities, setCategoryQuantities] = useState<Record<UUID, string>>({});
  const [backdatePolicy, setBackdatePolicy] = useState<InventoryBackdatePolicyRead | null>(null);
  const [movementDate, setMovementDate] = useState(() => toDateInputValue(new Date()));
  const [movementTime, setMovementTime] = useState(currentTimeDraft);
  const [movementCalendarOpen, setMovementCalendarOpen] = useState(false);
  const inventoryCursorRef = useRef<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const inventoryHasMoreRef = useRef(false);
  const inventoryLoadingRef = useRef(false);
  const inventoryLoadingMoreRef = useRef(false);
  const inventoryAbortRef = useRef<AbortController | null>(null);
  const inventoryRequestIdRef = useRef(0);
  const movementsLoadedKeyRef = useRef<string | null>(null);
  const movementsLoadingKeyRef = useRef<string | null>(null);
  const movementHistoryKeyRef = useRef<string | null>(null);
  const movementsRequestIdRef = useRef(0);

  const historyCalendarColors = useMemo<CalendarPickerColors>(
    () => ({
      overlay: "rgba(15, 23, 18, 0.42)",
      card: "#FFFFFF",
      surface: "#F6F2E8",
      border: "#D8CCB6",
      textPrimary: "#1D2A22",
      textSecondary: "#526057",
      textMuted: "#7A857E",
      accent: HISTORY_BUTTON_GREEN,
      accentSoft: "#DDEEE6",
      onAccent: "#FFFFFF",
    }),
    [],
  );
  const historyModeOptions = useMemo<{ key: MovementHistoryMode; label: string; icon: MaterialIconName }[]>(
    () => [
      { key: "date", label: t("inventory.historyDateMode"), icon: "calendar" },
      { key: "range", label: t("inventory.historyRangeMode"), icon: "calendar-range" },
    ],
    [t],
  );
  const movementHistoryParams = useMemo<MovementHistoryParams>(
    () =>
      historyMode === "date"
        ? {
          reference_date: historyDate,
          range_start_date: null,
          range_end_date: null,
        }
        : {
          reference_date: null,
          range_start_date: historyRangeStart,
          range_end_date: historyRangeEnd,
        },
    [historyDate, historyMode, historyRangeEnd, historyRangeStart],
  );
  const movementHistoryKey = useMemo(
    () => [
      historyMode,
      movementHistoryParams.reference_date ?? "",
      movementHistoryParams.range_start_date ?? "",
      movementHistoryParams.range_end_date ?? "",
    ].join(":"),
    [historyMode, movementHistoryParams],
  );

  const loadInventory = useCallback(async (refresh = false) => {
    inventoryAbortRef.current?.abort();
    const controller = new AbortController();
    inventoryAbortRef.current = controller;
    const requestId = ++inventoryRequestIdRef.current;
    inventoryLoadingRef.current = true;
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const [page, activeShops, policy] = await Promise.all([
        fetchShopInventoryRows(
          { limit: SHOP_INVENTORY_PAGE_SIZE },
          { signal: controller.signal },
        ),
        getActiveTransferShops(),
        fetchShopInventoryBackdatePolicy(),
      ]);
      if (controller.signal.aborted || requestId !== inventoryRequestIdRef.current) {
        return;
      }
      setShopName(page.shop_name);
      setItems(page.items);
      setTransferShops(activeShops);
      setBackdatePolicy(policy);
      setInventoryHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      inventoryCursorRef.current = nextCursor;
      inventoryHasMoreRef.current = page.has_more;
      setInventoryCursor(nextCursor);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
    } finally {
      if (inventoryAbortRef.current === controller) {
        inventoryAbortRef.current = null;
      }
      if (requestId === inventoryRequestIdRef.current) {
        inventoryLoadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  const loadMoreInventory = useCallback(async () => {
    if (
      !inventoryHasMoreRef.current ||
      inventoryLoadingRef.current ||
      inventoryLoadingMoreRef.current
    ) {
      return;
    }
    inventoryLoadingMoreRef.current = true;
    setInventoryLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchShopInventoryRows({
        limit: SHOP_INVENTORY_PAGE_SIZE,
        cursor_sort_order: inventoryCursorRef.current.sortOrder,
        cursor_name: inventoryCursorRef.current.name,
        cursor_id: inventoryCursorRef.current.id,
      });
      setShopName(page.shop_name);
      setItems((currentItems) => {
        const existingIds = new Set(currentItems.map((item) => item.id));
        return [...currentItems, ...page.items.filter((item: InventoryItemStockRead) => !existingIds.has(item.id))];
      });
      setInventoryHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      inventoryCursorRef.current = nextCursor;
      inventoryHasMoreRef.current = page.has_more;
      setInventoryCursor(nextCursor);
    } catch (error) {
      setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
    } finally {
      inventoryLoadingMoreRef.current = false;
      setInventoryLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    inventoryCursorRef.current = inventoryCursor;
  }, [inventoryCursor]);

  useEffect(() => {
    inventoryHasMoreRef.current = inventoryHasMore;
  }, [inventoryHasMore]);

  useEffect(() => {
    inventoryLoadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    inventoryLoadingMoreRef.current = inventoryLoadingMore;
  }, [inventoryLoadingMore]);

  useEffect(() => {
    movementsLoadedKeyRef.current = movementsLoadedKey;
  }, [movementsLoadedKey]);

  const loadMovements = useCallback(async (
    force = false,
    historyParams = movementHistoryParams,
    historyKey = movementHistoryKey,
  ) => {
    if (
      !force &&
      (movementsLoadingKeyRef.current === historyKey || movementsLoadedKeyRef.current === historyKey)
    ) {
      return;
    }
    const requestId = ++movementsRequestIdRef.current;
    movementsLoadingKeyRef.current = historyKey;
    setMovementsLoading(true);
    try {
      const [nextMovements, nextTransfers] = await Promise.all([
        fetchShopInventoryMovements({
          reference_date: historyParams.reference_date,
          range_start_date: historyParams.range_start_date,
          range_end_date: historyParams.range_end_date,
          limit: 100,
        }),
        fetchShopInventoryTransfers({
          reference_date: historyParams.reference_date,
          range_start_date: historyParams.range_start_date,
          range_end_date: historyParams.range_end_date,
          limit: 100,
        }),
      ]);
      if (requestId !== movementsRequestIdRef.current || movementHistoryKeyRef.current !== historyKey) {
        return;
      }
      setMovements(nextMovements.items);
      setTransfers(nextTransfers.items);
      movementsLoadedKeyRef.current = historyKey;
      setMovementsLoadedKey(historyKey);
    } catch (error) {
      if (requestId === movementsRequestIdRef.current && movementHistoryKeyRef.current === historyKey) {
        setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
      }
    } finally {
      if (requestId === movementsRequestIdRef.current) {
        movementsLoadingKeyRef.current = null;
        setMovementsLoading(false);
      }
    }
  }, [movementHistoryKey, movementHistoryParams, t]);

  useFocusEffect(useCallback(() => {
    void loadInventory();
    return undefined;
  }, [loadInventory]));

  useEffect(() => {
    movementHistoryKeyRef.current = movementHistoryKey;
    setMovements([]);
    movementsLoadedKeyRef.current = null;
    setMovementsLoadedKey(null);
  }, [movementHistoryKey]);

  useEffect(() => {
    if (historyOpen && movementsLoadedKey !== movementHistoryKey) {
      void loadMovements();
    }
  }, [historyOpen, loadMovements, movementHistoryKey, movementsLoadedKey]);

  const refreshInventory = useCallback(() => {
    void loadInventory(true);
    if (historyOpen) {
      void loadMovements(true);
    }
  }, [historyOpen, loadInventory, loadMovements]);

  const selectHistoryDate = useCallback((selectedDate: string) => {
    if (historyCalendarTarget === "date") {
      setHistoryDate(selectedDate);
    } else if (historyCalendarTarget === "start") {
      setHistoryRangeStart(selectedDate);
      setHistoryRangeEnd((currentEnd) => currentEnd < selectedDate ? selectedDate : currentEnd);
    } else if (historyCalendarTarget === "end") {
      setHistoryRangeEnd(selectedDate);
      setHistoryRangeStart((currentStart) => currentStart > selectedDate ? selectedDate : currentStart);
    }
    setHistoryCalendarTarget(null);
  }, [historyCalendarTarget]);

  const openMovement = useCallback((item: InventoryItemStockRead, nextMode: MovementMode) => {
    if (!item.is_active || !item.allocation_active) {
      void loadInventory(true);
      return;
    }
    setSelectedItem(item);
    setMode(nextMode);
    setTransferShopId(null);
    setQuantity("");
    setDriverName("");
    setVehicleNumber("");
    setCategoryQuantities({});
    setMovementDate(toDateInputValue(new Date()));
    setMovementTime(currentTimeDraft());
  }, [loadInventory]);

  const movementOccurredAt = useMemo(() => {
    if (!backdatePolicy?.allow_shop_backdated_inventory) {
      return undefined;
    }
    return buildOccurredAtPayload(movementDate, movementTime) ?? undefined;
  }, [backdatePolicy, movementDate, movementTime]);

  const movementDateBounds = useMemo(() => {
    const today = new Date();
    const maxDate = toDateInputValue(today);
    const windowDays = backdatePolicy?.shop_backdate_window_days ?? 0;
    const earliest = new Date(today);
    earliest.setDate(earliest.getDate() - windowDays);
    return { minDate: toDateInputValue(earliest), maxDate };
  }, [backdatePolicy]);

  const closeMovement = useCallback(() => {
    setSelectedItem(null);
    setTransferShopId(null);
    setQuantity("");
    setDriverName("");
    setVehicleNumber("");
    setCategoryQuantities({});
    setMovementCalendarOpen(false);
    setKeyboardInset(0);
    keyboardInsetRef.current = 0;
    movementScrollOffsetRef.current = 0;
    movementActiveFieldRef.current = null;
  }, []);

  const scrollMovementFieldIntoView = useCallback((field: View | null, inset = keyboardInsetRef.current) => {
    if (!field || inset <= 0) {
      return;
    }
    const runScroll = () => {
      field.measureInWindow((_x, y, _width, height) => {
        const keyboardTop = Dimensions.get("window").height - inset;
        const targetBottom = keyboardTop - 40;
        const overlap = y + height - targetBottom;
        if (overlap > 0) {
          movementScrollRef.current?.scrollTo({
            y: movementScrollOffsetRef.current + overlap,
            animated: true,
          });
        }
      });
    };
    requestAnimationFrame(runScroll);
    setTimeout(runScroll, Platform.OS === "android" ? 280 : 120);
  }, []);

  const focusMovementField = useCallback((field: View | null) => {
    movementActiveFieldRef.current = field;
    scrollMovementFieldIntoView(field);
    setTimeout(() => scrollMovementFieldIntoView(field), 80);
    setTimeout(() => scrollMovementFieldIntoView(field), Platform.OS === "android" ? 320 : 180);
  }, [scrollMovementFieldIntoView]);

  useEffect(() => {
    if (!selectedItem) {
      setKeyboardInset(0);
      keyboardInsetRef.current = 0;
      return undefined;
    }
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const inset = event.endCoordinates.height;
      keyboardInsetRef.current = inset;
      setKeyboardInset(inset);
      const activeField = movementActiveFieldRef.current ?? movementQuantityFieldRef.current;
      requestAnimationFrame(() => {
        scrollMovementFieldIntoView(activeField, inset);
      });
      setTimeout(() => scrollMovementFieldIntoView(activeField, inset), Platform.OS === "android" ? 320 : 120);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardInsetRef.current = 0;
      setKeyboardInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [selectedItem, scrollMovementFieldIntoView]);

  const splitState = useMemo(() => {
    if (!selectedItem) {
      return {
        splitTotal: money(0),
        hasValidTotal: false,
        canSave: false,
      };
    }
    const hasCategories = selectedItem.category_usage.length > 0;
    const useAutoTotal = mode === InventoryMovementType.USE && hasCategories;
    let hasInvalidSplit = false;
    const splitTotal = selectedItem.category_usage.reduce((currentTotal, category) => {
      const parsed = parseQuantityDraft(categoryQuantities[category.category_id] ?? "");
      if (
        !parsed ||
        parsed.lessThan(0) ||
        (selectedItem.base_unit === BaseUnit.UNIT && !isWholeDecimalValue(parsed))
      ) {
        hasInvalidSplit = true;
        return currentTotal;
      }
      return currentTotal.plus(parsed);
    }, money(0));
    const manualTotal = parseQuantityDraft(quantity);
    const total = useAutoTotal ? (hasInvalidSplit ? null : splitTotal) : manualTotal;
    const hasValidTotal = Boolean(
      total &&
      total.greaterThan(0) &&
      (selectedItem.base_unit !== BaseUnit.UNIT || isWholeDecimalValue(total)),
    );
    const withinAvailable = total
      ? total.toDecimalPlaces(3).lessThanOrEqualTo(money(selectedItem.available_quantity).toDecimalPlaces(3))
      : false;
    return {
      splitTotal,
      hasValidTotal,
      canSave: mode === InventoryMovementType.ADD
        ? hasValidTotal && Boolean(driverName.trim()) && Boolean(vehicleNumber.trim())
        : mode === "TRANSFER"
          ? hasValidTotal && withinAvailable && transferShopId !== null
          : useAutoTotal
            ? !hasInvalidSplit && splitTotal.greaterThan(0) && withinAvailable
            : hasValidTotal && withinAvailable,
    };
  }, [categoryQuantities, mode, quantity, selectedItem, driverName, vehicleNumber, transferShopId]);

  const saveMovement = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    const hasCategorySplit = mode === InventoryMovementType.USE && selectedItem.category_usage.length > 0;
    const rawQuantity = hasCategorySplit
      ? splitState.splitTotal.toDecimalPlaces(3).toString()
      : quantity.trim();
    if (!rawQuantity || money(rawQuantity).lessThanOrEqualTo(0)) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.invalidQuantityMessage"));
      return;
    }
    if (selectedItem.base_unit === BaseUnit.UNIT && !isWholeQuantity(rawQuantity)) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("billing.alertInvalidUnitQuantityMessage", {
        itemName: getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name),
      }));
      return;
    }
    if (mode === InventoryMovementType.USE && !splitState.canSave) {
      if (selectedItem.category_usage.length > 0) {
        Alert.alert(t("inventory.categoryRequiredTitle"), t("inventory.categoryRequiredMessage"));
      } else {
        Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.invalidQuantityMessage"));
      }
      return;
    }
    setSaving(true);
    try {
      let changedItem: InventoryItemStockRead;
      const occurredAt = movementOccurredAt;
      if (mode === InventoryMovementType.ADD) {
        if (!driverName.trim() || !vehicleNumber.trim()) {
          Alert.alert(t("inventory.driverVehicleRequiredTitle" as any), t("inventory.driverVehicleRequiredMessage" as any));
          setSaving(false);
          return;
        }
        const result = await addShopInventoryStock(selectedItem.id, {
          quantity: rawQuantity,
          driver_name: driverName.trim(),
          vehicle_number: vehicleNumber.trim(),
          occurred_at: occurredAt,
        });
        changedItem = result.item;
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      } else if (mode === "TRANSFER") {
        if (!transferShopId) {
          Alert.alert("Select Destination", "Please select a transfer destination.");
          setSaving(false);
          return;
        }
        await transferInventoryStock(selectedItem.id, {
          transfer_shop_id: transferShopId,
          quantity: rawQuantity,
          occurred_at: occurredAt,
        });
        void loadInventory(true);
      } else if (selectedItem.category_usage.length === 0) {
        const result = await useShopInventoryStock(selectedItem.id, { quantity: rawQuantity, occurred_at: occurredAt });
        changedItem = result.item;
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      } else {
        const result = await useShopInventoryStockSplit(selectedItem.id, {
          total_quantity: rawQuantity,
          categories: selectedItem.category_usage.map((category) => ({
            category_id: category.category_id,
            quantity: categoryQuantities[category.category_id]?.trim() || "0",
          })),
          occurred_at: occurredAt,
        });
        changedItem = result.item;
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      }
      if (historyOpen) {
        void loadMovements(true);
      } else {
        setMovements([]);
        movementsLoadedKeyRef.current = null;
        setMovementsLoadedKey(null);
      }
      closeMovement();
    } catch (error) {
      const apiError = toApiError(error);
      const normalizedMessage = apiError.message.toLowerCase();
      const inventoryUnavailable =
        normalizedMessage.includes("inactive") ||
        normalizedMessage.includes("not allocated");
      if (inventoryUnavailable) {
        closeMovement();
        void loadInventory(true);
      }
      Alert.alert(t("inventory.saveFailedTitle"), apiError.message || t("inventory.saveFailedMessage"));
    } finally {
      setSaving(false);
    }
  }, [
    categoryQuantities,
    closeMovement,
    driverName,
    historyOpen,
    language,
    loadInventory,
    loadMovements,
    mode,
    quantity,
    selectedItem,
    splitState.canSave,
    t,
    transferShopId,
    movementOccurredAt,
  ]);

  if (loading && items.length === 0) {
    return <LoadingState fullscreen label={t("inventory.loading")} />;
  }

  if (errorMessage && items.length === 0) {
    return (
      <Screen>
        <EmptyState title={t("inventory.loadFailed")} description={errorMessage} />
        <Button label={t("action.tryAgain")} onPress={() => void loadInventory()} className="mt-4" />
      </Screen>
    );
  }

  const renderInventoryRow = ({ item }: { item: InventoryItemStockRead }) => {
    const itemName = getLocalizedItemName(language, item.name, item.tamil_name);
    return (
      <Card className="gap-4">
        <View className="flex-row gap-3">
          <ItemThumbnail
            uri={getItemThumbnailUri(item)}
            recyclingKey={item.id}
            size={58}
            borderRadius={14}
            backgroundColor="#F4F7F2"
            icon="warehouse"
            iconColor="#4B6356"
          />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-extrabold text-ink" numberOfLines={2}>{itemName}</Text>
            <Text className="mt-1 text-sm font-semibold text-muted">
              {formatQuantity(item.available_quantity, item.base_unit)} {t("inventory.available")}
            </Text>
            <Text className="mt-1 text-xs font-semibold text-muted">
              {t("inventory.used")} {formatQuantity(item.used_quantity, item.base_unit)}
            </Text>
          </View>
        </View>
        <View className="flex-col gap-2">
          <View className="flex-row gap-2">
            <Button
              label={t("inventory.addStock")}
              onPress={() => openMovement(item, InventoryMovementType.ADD)}
              className="flex-1"
            />
            <Button
              label={t("inventory.useStock")}
              onPress={() => openMovement(item, InventoryMovementType.USE)}
              variant="secondary"
              disabled={money(item.available_quantity).lessThanOrEqualTo(0)}
              className="flex-1"
            />
          </View>
          {transferShops.length > 0 && (
            <Button
              label="Transfer Stock"
              onPress={() => openMovement(item, "TRANSFER")}
              variant="secondary"
              disabled={money(item.available_quantity).lessThanOrEqualTo(0)}
              className="w-full border-dashed"
            />
          )}
        </View>
        <View className="gap-2 border-t border-border/70 pt-3">
          {item.category_usage.map((category) => (
            <View key={category.category_id} className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm font-semibold text-ink" numberOfLines={1}>
                {category.category_name}
              </Text>
              <Text className="text-xs font-semibold text-muted">
                {t("inventory.used")} {formatQuantity(category.used_quantity, item.base_unit)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    );
  };

  const renderInventoryFooter = () => (
    <View className="gap-3 pt-1">
      {inventoryLoadingMore ? (
        <Card className="items-center border-border bg-card">
          <ActivityIndicator color="#244734" />
        </Card>
      ) : null}
      <View className="w-full items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: historyOpen }}
          onPress={() => setHistoryOpen((current) => !current)}
          className="flex-row items-center justify-center gap-2"
          style={{
            width: "100%",
            minHeight: 52,
            borderWidth: 1,
            borderRadius: 12,
            paddingHorizontal: 22,
            backgroundColor: historyOpen ? "#FFFFFF" : HISTORY_BUTTON_GREEN,
            borderColor: HISTORY_BUTTON_GREEN,
          }}
        >
          <MaterialCommunityIcons
            name={historyOpen ? "chevron-up" : "history"}
            size={20}
            color={historyOpen ? HISTORY_BUTTON_GREEN : "#FFFFFF"}
          />
          <Text
            className="text-sm font-extrabold"
            style={{ color: historyOpen ? HISTORY_BUTTON_GREEN : "#FFFFFF" }}
          >
            {historyOpen ? t("inventory.hideHistory") : t("inventory.history")}
          </Text>
        </Pressable>
      </View>
      {historyOpen ? (
        <>
          <Card className="gap-3 border-border bg-card">
            <View className="flex-row gap-2 mb-1 bg-surface-muted rounded-xl p-1 border border-border">
              {(
                [
                  { key: "movements", label: "Stock Add/Use" },
                  { key: "transfers", label: "Stock Transfers" },
                ] as const
              ).map((tab) => {
                const active = historyTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setHistoryTab(tab.key)}
                    className="flex-1 rounded-lg py-2 items-center justify-center"
                    style={{ backgroundColor: active ? "#FFFFFF" : "transparent" }}
                  >
                    <Text
                      className="text-xs font-extrabold"
                      style={{ color: active ? HISTORY_BUTTON_GREEN : "#7A857E" }}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row gap-2">
              {historyModeOptions.map((option) => {
                const active = historyMode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setHistoryMode(option.key)}
                    style={({ pressed }) => ({
                      flex: 1,
                      minHeight: 40,
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      borderColor: active ? HISTORY_BUTTON_GREEN : "#D8CCB6",
                      backgroundColor: active ? HISTORY_BUTTON_GREEN : "#F6F2E8",
                      opacity: pressed ? 0.78 : 1,
                    })}
                  >
                    <MaterialCommunityIcons
                      name={option.icon}
                      size={16}
                      color={active ? "#FFFFFF" : "#7A857E"}
                    />
                    <Text
                      className="text-xs font-extrabold"
                      style={{ color: active ? "#FFFFFF" : "#1D2A22" }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {historyMode === "date" ? (
              <CalendarDateField
                label={t("inventory.historyDate")}
                value={historyDate}
                colors={historyCalendarColors}
                onPress={() => setHistoryCalendarTarget("date")}
              />
            ) : (
              <View className="flex-row flex-wrap gap-3">
                <CalendarDateField
                  label={t("inventory.historyFrom")}
                  value={historyRangeStart}
                  colors={historyCalendarColors}
                  icon="calendar-start"
                  onPress={() => setHistoryCalendarTarget("start")}
                />
                <CalendarDateField
                  label={t("inventory.historyTo")}
                  value={historyRangeEnd}
                  colors={historyCalendarColors}
                  icon="calendar-end"
                  onPress={() => setHistoryCalendarTarget("end")}
                />
              </View>
            )}
          </Card>
          <Text className="text-base font-extrabold text-ink">{t("inventory.movementHistory")}</Text>
          {movementsLoading ? (
            <Card className="flex-row items-center gap-3 border-border bg-card">
              <ActivityIndicator color="#244734" />
              <Text className="text-sm font-semibold text-muted">{t("inventory.loading")}</Text>
            </Card>
          ) : historyTab === "transfers" ? (
            transfers.length === 0 ? (
              <Card className="border-border bg-card">
                <Text className="text-sm font-semibold text-muted">No stock transfers found.</Text>
              </Card>
            ) : (
              transfers.map((transfer) => {
                const transferItemName = getLocalizedItemName(
                  language,
                  transfer.inventory_item_name ?? "",
                  transfer.inventory_item_tamil_name ?? "",
                );
                return (
                  <Card key={transfer.id} className="flex-row items-center gap-3">
                    <MaterialCommunityIcons
                      name="truck-delivery-outline"
                      size={22}
                      color="#B27B2B"
                    />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-extrabold text-ink" numberOfLines={1}>
                        {transferItemName}
                      </Text>
                      <Text className="mt-0.5 text-xs font-semibold text-muted" numberOfLines={1}>
                        Transferred to: {transfer.transfer_shop_name} · {formatQuantity(transfer.quantity, transfer.unit as BaseUnit)}
                      </Text>
                      <Text className="mt-0.5 text-[11px] font-semibold text-muted">
                        {formatDateTime(transfer.occurred_at)}
                      </Text>
                      {movementRecordedLabel(transfer.occurred_at, transfer.created_at) ? (
                        <Text className="mt-0.5 text-[11px] font-semibold text-muted">
                          {movementRecordedLabel(transfer.occurred_at, transfer.created_at)}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                );
              })
            )
          ) : movements.length === 0 ? (
            <Card className="border-border bg-card">
              <Text className="text-sm font-semibold text-muted">{t("inventory.noStockMovement")}</Text>
            </Card>
          ) : (
            movements.map((movement) => {
              const movementItemName = getLocalizedItemName(
                language,
                movement.inventory_item_name ?? "",
                movement.inventory_item_tamil_name ?? "",
              );
              const isAdd = movement.movement_type === InventoryMovementType.ADD;
              const movementLabel = isAdd
                ? t("inventory.movementAdded")
                : movement.category_name
                  ? t("inventory.movementUsedFor", { categoryName: movement.category_name })
                  : t("inventory.used");
              return (
                <Card key={movement.id} className="flex-row items-center gap-3">
                  <MaterialCommunityIcons
                    name={isAdd ? "plus-circle-outline" : "minus-circle-outline"}
                    size={22}
                    color={isAdd ? "#168A5B" : "#9F4335"}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-extrabold text-ink" numberOfLines={1}>
                      {movementItemName}
                    </Text>
                    <Text className="mt-0.5 text-xs font-semibold text-muted" numberOfLines={1}>
                      {movementLabel} · {formatQuantity(movement.quantity, movement.unit)}
                    </Text>
                    {movement.driver_name || movement.vehicle_number ? (
                      <Text className="mt-0.5 text-[11px] font-semibold text-muted" numberOfLines={1}>
                        {movement.driver_name ? `Driver: ${movement.driver_name}` : ""}{movement.driver_name && movement.vehicle_number ? " · " : ""}{movement.vehicle_number ? `Vehicle: ${movement.vehicle_number}` : ""}
                      </Text>
                    ) : null}
                    <Text className="mt-0.5 text-[11px] font-semibold text-muted">
                      {formatDateTime(movement.occurred_at)}
                    </Text>
                    {movementRecordedLabel(movement.occurred_at, movement.created_at) ? (
                      <Text className="mt-0.5 text-[11px] font-semibold text-muted">
                        {movementRecordedLabel(movement.occurred_at, movement.created_at)}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              );
            })
          )}
        </>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <Screen scroll={false}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderInventoryRow}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshInventory} tintColor="#244734" colors={["#244734"]} />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 28, gap: 16 }}
          ListHeaderComponent={(
            <>
              {errorMessage ? (
                <Card className="border-[#9F4335] bg-[#FFF2EF]">
                  <Text className="text-sm font-semibold text-[#9F4335]">{errorMessage}</Text>
                </Card>
              ) : null}
              {shopName ? (
                <View className="rounded-control border border-border bg-card px-4 py-3">
                  <Text className="text-xs font-extrabold uppercase tracking-[1px] text-muted">
                    {t("inventory.branchName", { branchName: shopName })}
                  </Text>
                </View>
              ) : null}
            </>
          )}
          ListEmptyComponent={
            !loading ? (
              <EmptyState title={t("inventory.emptyTitle")} description={t("inventory.emptyDescription")} />
            ) : null
          }
          ListFooterComponent={renderInventoryFooter}
          onEndReached={() => void loadMoreInventory()}
          onEndReachedThreshold={0.35}
        />
      </Screen>

      <View className="px-4 pb-4 pt-2">
        <Button
          label={t("action.backToBilling")}
          onPress={() => navigation.navigate("Billing")}
          variant="secondary"
          className="w-full"
        />
      </View>

      <Modal visible={Boolean(selectedItem)} animationType="fade" transparent onRequestClose={closeMovement}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <View className="flex-1 bg-black/45">
            <ScrollView
              ref={movementScrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(event) => {
                movementScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
              }}
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: keyboardInset > 0 ? "flex-start" : "center",
                paddingHorizontal: 16,
                paddingTop: 24,
                paddingBottom: keyboardInset > 0 ? keyboardInset + 48 : 24,
              }}
            >
              <View
                className="w-full self-center rounded-[20px] border border-border bg-card p-4 "
                style={{ maxWidth: 460 }}
              >
                {selectedItem ? (
                  <View className="gap-3">
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1">
                        <Text className="text-lg font-extrabold text-ink">
                          {mode === InventoryMovementType.ADD ? t("inventory.addStock") : mode === "TRANSFER" ? "Transfer Stock" : t("inventory.useStock")}
                        </Text>
                        <Text className="mt-1 text-sm font-semibold text-muted" numberOfLines={2}>
                          {getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name)}
                        </Text>
                      </View>
                      <Pressable accessibilityRole="button" onPress={closeMovement} className="h-10 w-10 items-center justify-center">
                        <MaterialCommunityIcons name="close" size={22} color="#1E2B22" />
                      </Pressable>
                    </View>

                    {backdatePolicy?.allow_shop_backdated_inventory ? (
                      <View className="gap-3 rounded-card border border-border bg-surface px-3 py-3">
                        <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                          Transaction date
                        </Text>
                        <CalendarDateField
                          label="Date"
                          value={movementDate}
                          colors={historyCalendarColors}
                          onPress={() => setMovementCalendarOpen(true)}
                        />
                        <TextField
                          label="Time"
                          placeholder="HH:MM"
                          value={movementTime}
                          onChangeText={setMovementTime}
                          keyboardType="numbers-and-punctuation"
                          selectTextOnFocus={false}
                        />
                      </View>
                    ) : null}

                    {mode === InventoryMovementType.USE || mode === "TRANSFER" ? (
                      <View className="items-center rounded-card border border-accent bg-accentSoft px-4 py-3">
                        <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                          {t("inventory.available")}
                        </Text>
                        <Text className="mt-1 text-3xl font-extrabold text-ink">
                          {formatQuantity(selectedItem.available_quantity, selectedItem.base_unit)}
                        </Text>
                      </View>
                    ) : null}
                    {mode === InventoryMovementType.USE && selectedItem.category_usage.length > 0 ? (
                      <View className="items-center rounded-card border border-border bg-card px-4 py-3">
                        <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                          {selectedItem.base_unit === BaseUnit.KG ? "Total to use (kg)" : "Total to use (units)"}
                        </Text>
                        <Text className="mt-1 text-3xl font-extrabold text-ink">
                          {formatQuantity(splitState.splitTotal.toString(), selectedItem.base_unit)}
                        </Text>
                      </View>
                    ) : (
                      <View
                        ref={(node) => {
                          movementQuantityFieldRef.current = node;
                        }}
                      >
                        <TextField
                          label={selectedItem.base_unit === BaseUnit.KG ? t("common.quantityKg") : t("common.quantityUnits")}
                          keyboardType="decimal-pad"
                          placeholder={selectedItem.base_unit === BaseUnit.KG ? t("common.exampleKg") : t("common.exampleUnits")}
                          value={quantity}
                          onChangeText={setQuantity}
                          suffix={selectedItem.base_unit}
                          autoFocus={mode === InventoryMovementType.USE}
                          selectTextOnFocus={false}
                          onFocus={() => focusMovementField(movementQuantityFieldRef.current)}
                          className={mode === InventoryMovementType.USE || mode === "TRANSFER" ? "text-center text-2xl font-extrabold" : undefined}
                        />
                        {mode === InventoryMovementType.ADD ? (
                          <View className="mt-4 gap-4">
                            <TextField
                              label={t("inventory.driverName" as any)}
                              placeholder={t("inventory.driverNamePlaceholder" as any)}
                              value={driverName}
                              onChangeText={setDriverName}
                              selectTextOnFocus={false}
                            />
                            <TextField
                              label={t("inventory.vehicleNumber" as any)}
                              placeholder={t("inventory.vehicleNumberPlaceholder" as any)}
                              value={vehicleNumber}
                              onChangeText={setVehicleNumber}
                              selectTextOnFocus={false}
                              autoCapitalize="characters"
                            />
                          </View>
                        ) : null}
                        {mode === "TRANSFER" ? (
                          <View className="mt-4">
                            <TransferShopPicker
                              shops={transferShops}
                              selectedShopId={transferShopId}
                              loading={loading}
                              palette={{
                                border: "#D8CCB6",
                                card: "#FFFFFF",
                                textMuted: "#7A857E",
                                textPrimary: "#111811",
                                textSecondary: "#303A33",
                                overlay: "rgba(0, 0, 0, 0.4)",
                                items: HISTORY_BUTTON_GREEN,
                                itemsSoft: "#E8F3EB",
                                itemsStrong: HISTORY_BUTTON_GREEN,
                                surfaceMuted: "#F7F5F0",
                              }}
                              onSelectShop={setTransferShopId}
                            />
                          </View>
                        ) : null}
                      </View>
                    )}
                    {mode === InventoryMovementType.USE && selectedItem.category_usage.length > 0 ? (
                      <View className="gap-2">
                        <View className="flex-row items-center justify-between gap-3">
                          <Text className="text-[11px] font-semibold uppercase text-muted">{t("inventory.category")}</Text>
                          <Text className="text-[11px] font-semibold uppercase text-muted">Split</Text>
                        </View>
                        <View className="gap-2">
                          {selectedItem.category_usage.map((category) => (
                            <View
                              key={category.category_id}
                              ref={(node) => {
                                movementCategoryFieldRefs.current[category.category_id] = node;
                              }}
                              className="min-h-[62px] flex-row items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
                            >
                              <View className="min-w-0 flex-1">
                                <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                                  {category.category_name}
                                </Text>
                                <Text className="mt-0.5 text-xs font-semibold text-muted">
                                  {t("inventory.used")} {formatQuantity(category.used_quantity, selectedItem.base_unit)}
                                </Text>
                              </View>
                              <View className="h-14 w-40 flex-row items-center rounded-control border border-border bg-card px-3">
                                <TextInput
                                  keyboardType="decimal-pad"
                                  placeholder={selectedItem.base_unit === BaseUnit.KG ? t("common.exampleKg") : t("common.exampleUnits")}
                                  placeholderTextColor="#95A293"
                                  value={categoryQuantities[category.category_id] ?? ""}
                                  onChangeText={(nextQuantity) =>
                                    setCategoryQuantities((current) => ({
                                      ...current,
                                      [category.category_id]: nextQuantity,
                                    }))
                                  }
                                  onFocus={() => focusMovementField(movementCategoryFieldRefs.current[category.category_id])}
                                  selectTextOnFocus={false}
                                  autoCorrect={false}
                                  underlineColorAndroid="transparent"
                                  selectionColor="#244734"
                                  cursorColor="#244734"
                                  className="min-w-0 flex-1 text-center text-xl font-extrabold text-ink"
                                />
                                <Text className="ml-2 text-xs font-semibold uppercase text-muted">{selectedItem.base_unit}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    <View className="flex-row gap-2 pt-1">
                      <Button label={t("action.cancel")} onPress={closeMovement} variant="secondary" className="flex-1" />
                      <Button
                        label={saving ? t("inventory.saving") : t("inventory.save")}
                        onPress={() => void saveMovement()}
                        loading={saving}
                        disabled={!splitState.canSave}
                        className="flex-1"
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CalendarDatePickerModal
        visible={historyCalendarTarget !== null}
        title={
          historyCalendarTarget === "start"
            ? t("inventory.historyFrom")
            : historyCalendarTarget === "end"
              ? t("inventory.historyTo")
              : t("inventory.historyDate")
        }
        value={
          historyCalendarTarget === "start"
            ? historyRangeStart
            : historyCalendarTarget === "end"
              ? historyRangeEnd
              : historyDate
        }
        rangeStartDate={historyMode === "range" ? historyRangeStart : null}
        rangeEndDate={historyMode === "range" ? historyRangeEnd : null}
        colors={historyCalendarColors}
        onSelect={selectHistoryDate}
        onClose={() => setHistoryCalendarTarget(null)}
      />

      <CalendarDatePickerModal
        visible={movementCalendarOpen}
        title="Transaction date"
        value={movementDate}
        colors={historyCalendarColors}
        onSelect={(selectedDate) => {
          if (selectedDate < movementDateBounds.minDate) {
            setMovementDate(movementDateBounds.minDate);
          } else if (selectedDate > movementDateBounds.maxDate) {
            setMovementDate(movementDateBounds.maxDate);
          } else {
            setMovementDate(selectedDate);
          }
          setMovementCalendarOpen(false);
        }}
        onClose={() => setMovementCalendarOpen(false)}
      />
    </View>
  );
}
