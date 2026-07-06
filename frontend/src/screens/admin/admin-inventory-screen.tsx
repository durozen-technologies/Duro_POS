 import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  allocateShopInventoryItems,
  createInventoryCategory,
  deleteInventoryCategory,
  deleteInventoryItem,
  fetchAdminInventoryMovements,
  fetchAdminRetailerInventoryUsages,
  fetchInventoryCategories,
  fetchInventoryItemCounts,
  fetchInventoryItemRows,
  fetchInventoryPurchaseRatesHistory,
  fetchShopInventoryAllocationRows,
  fetchShops,
  updateInventoryCategory,
  confirmInventoryPurchaseRatesToday,
  updateInventoryItemPurchaseRate,
  updateShopInventoryAllocation,
  adminSetShopInventoryStock,
  adminSetRetailerInventoryStock,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  formatCalendarDateLabel,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import {
  BaseUnit,
  InventoryMovementType,
  type InventoryCategoryRead,
  type InventoryItemRead,
  type InventoryItemStockRead,
  type InventoryMovementRead,
  type RetailerInventoryUsageRead,
  type ShopRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { formatDateTime } from "@/utils/format";
import { toDateInputValue } from "@/utils/expense-history-filters";
import { getItemThumbnailUri } from "@/utils/item-images";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { ActionButton, IconButton, EmptyStateCard, SearchField } from "./components/admin-dashboard-primitives";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { AdminTransferShopsTab } from "./components/admin-transfer-shops-tab";
import { useAdminTheme } from "./use-admin-theme";
import type { AdminInventoryScreenProps } from "@/navigation/types";

type InventoryTab = "items" | "categories" | "purchaseRates" | "shops" | "transferShops";
type MovementHistoryMode = "date" | "range";
type MovementHistoryCalendarTarget = "date" | "start" | "end";
const INVENTORY_ITEM_PAGE_SIZE = 50;
const INVENTORY_STOCK_PAGE_SIZE = 50;

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

function getRequestMessage(error: unknown, fallback: string) {
  return toApiError(error).message || fallback;
}

function formatInventoryQuantity(value: string | number, unit: BaseUnit) {
  const numeric = money(value).toNumber();
  const display = unit === BaseUnit.UNIT && Number.isInteger(numeric)
    ? `${numeric}`
    : numeric.toFixed(unit === BaseUnit.UNIT ? 0 : 3).replace(/\.?0+$/, "");
  return `${display || "0"} ${unit === BaseUnit.KG ? "kg" : numeric === 1 ? "unit" : "units"}`;
}

function formatPurchaseRate(value: string | number, unit: BaseUnit) {
  return `₹${money(value).toFixed(2)}/${unit === BaseUnit.KG ? "kg" : "unit"}`;
}

function isPurchaseRateUpdatedToday(updatedAt?: string | null) {
  if (!updatedAt) {
    return false;
  }
  return toDateInputValue(new Date(updatedAt)) === toDateInputValue(new Date());
}

function inventoryItemBillingNames(item: InventoryItemRead) {
  return (Array.isArray(item.billing_items) ? item.billing_items : []).map(
    (billingItem) =>
      billingItem.inventory_category_name
        ? `${billingItem.inventory_category_name}: ${billingItem.billing_item_name}`
        : billingItem.billing_item_name,
  );
}

function inventoryItemCategoryLabel(item: InventoryItemRead) {
  const categories = Array.isArray(item.categories) ? item.categories : [];
  if (categories.length === 0) {
    return "No categories";
  }
  return categories.map((category) => category.name).join(", ");
}

function markInventoryItemAllocated(
  items: InventoryItemStockRead[],
  itemId: UUID,
) {
  return items.map((item) =>
    item.id === itemId
      ? {
        ...item,
        allocated: true,
        allocation_active: item.is_active,
        allocation_sort_order: item.allocation_sort_order ?? item.sort_order,
      }
      : item,
  );
}

function patchStockItem(
  items: InventoryItemStockRead[],
  changedItem: InventoryItemStockRead,
) {
  return items.map((item) => (item.id === changedItem.id ? changedItem : item));
}

export function AdminInventoryScreen({ navigation, route }: AdminInventoryScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<InventoryTab>(route.params?.tab ?? "items");
  const [items, setItems] = useState<InventoryItemRead[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryRead[]>([]);
  const [shops, setShops] = useState<ShopRead[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(route.params?.shopId ?? null);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [stockItems, setStockItems] = useState<InventoryItemStockRead[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoadingMore, setStockLoadingMore] = useState(false);
  const [stockHasMore, setStockHasMore] = useState(false);
  const [stockCursor, setStockCursor] = useState<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const [stockLoadedShopId, setStockLoadedShopId] = useState<UUID | null>(null);
  const [movements, setMovements] = useState<InventoryMovementRead[]>([]);
  const [retailerUsages, setRetailerUsages] = useState<RetailerInventoryUsageRead[]>([]);
  const [adminHistoryTab, setAdminHistoryTab] = useState<"movements" | "retailer">("movements");
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsLoadedKey, setMovementsLoadedKey] = useState<string | null>(null);
  const [movementHistoryOpen, setMovementHistoryOpen] = useState(false);
  const [movementHistoryMode, setMovementHistoryMode] = useState<MovementHistoryMode>("date");
  const [movementHistoryDate, setMovementHistoryDate] = useState(() => toDateInputValue(new Date()));
  const [movementHistoryRangeStart, setMovementHistoryRangeStart] = useState(() => toDateInputValue(new Date()));
  const [movementHistoryRangeEnd, setMovementHistoryRangeEnd] = useState(() => toDateInputValue(new Date()));
  const [movementCalendarTarget, setMovementCalendarTarget] = useState<MovementHistoryCalendarTarget | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsLoadingMore, setItemsLoadingMore] = useState(false);
  const [itemsHasMore, setItemsHasMore] = useState(false);
  const [itemsTotalCount, setItemsTotalCount] = useState(0);
  const [itemsCursor, setItemsCursor] = useState<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [baseReloadKey, setBaseReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocationBusyItemId, setAllocationBusyItemId] = useState<UUID | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<UUID | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingStockKey, setEditingStockKey] = useState<string | null>(null);
  const [editingStockValue, setEditingStockValue] = useState("");
  const [editingPurchaseRateId, setEditingPurchaseRateId] = useState<UUID | null>(null);
  const [editingPurchaseRateValue, setEditingPurchaseRateValue] = useState("");
  const [savingPurchaseRateId, setSavingPurchaseRateId] = useState<UUID | null>(null);
  const [savingAllPurchaseRates, setSavingAllPurchaseRates] = useState(false);
  const [purchaseRateHistoryDate, setPurchaseRateHistoryDate] = useState(() => toDateInputValue(new Date()));
  const [purchaseRateCalendarOpen, setPurchaseRateCalendarOpen] = useState(false);
  const [historicalPurchaseRates, setHistoricalPurchaseRates] = useState<Record<string, string>>({});
  const [loadingHistoricalRates, setLoadingHistoricalRates] = useState(false);
  const debouncedSearchRef = useRef("");
  const loadedItemsQueryRef = useRef<string | null>(null);
  const itemsAbortRef = useRef<AbortController | null>(null);
  const itemsRequestIdRef = useRef(0);
  const itemsCursorRef = useRef<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const itemsHasMoreRef = useRef(false);
  const itemsLoadingRef = useRef(true);
  const itemsLoadingMoreRef = useRef(false);
  const stockAbortRef = useRef<AbortController | null>(null);
  const stockRequestIdRef = useRef(0);
  const stockCursorRef = useRef<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const stockHasMoreRef = useRef(false);
  const stockLoadingRef = useRef(false);
  const stockLoadingMoreRef = useRef(false);
  const stockLoadedShopIdRef = useRef<UUID | null>(null);
  const movementsLoadingRef = useRef(false);
  const movementsLoadedKeyRef = useRef<string | null>(null);

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );
  const movementCalendarColors = useMemo<CalendarPickerColors>(
    () => ({
      overlay: palette.overlay,
      card: palette.card,
      surface: palette.surfaceMuted,
      border: palette.border,
      textPrimary: palette.textPrimary,
      textSecondary: palette.textSecondary,
      textMuted: palette.textMuted,
      accent: palette.inventory,
      accentSoft: palette.inventorySoft,
      onAccent: palette.onPrimary,
    }),
    [palette],
  );
  const movementHistoryParams = useMemo(
    () =>
      movementHistoryMode === "date"
        ? {
          reference_date: movementHistoryDate,
          range_start_date: null,
          range_end_date: null,
        }
        : {
          reference_date: null,
          range_start_date: movementHistoryRangeStart,
          range_end_date: movementHistoryRangeEnd,
        },
    [movementHistoryDate, movementHistoryMode, movementHistoryRangeEnd, movementHistoryRangeStart],
  );
  const movementHistoryKey = useMemo(
    () =>
      selectedShopId
        ? [
          selectedShopId,
          movementHistoryMode,
          movementHistoryParams.reference_date ?? "",
          movementHistoryParams.range_start_date ?? "",
          movementHistoryParams.range_end_date ?? "",
        ].join(":")
        : null,
    [movementHistoryMode, movementHistoryParams, selectedShopId],
  );

  const isTodayPurchaseRate = purchaseRateHistoryDate === toDateInputValue(new Date());

  useEffect(() => {
    if (activeTab === "purchaseRates" && !isTodayPurchaseRate) {
      let active = true;
      setLoadingHistoricalRates(true);
      fetchInventoryPurchaseRatesHistory(purchaseRateHistoryDate)
        .then((rates) => {
          if (active) {
            const rateMap: Record<string, string> = {};
            for (const r of rates) {
              rateMap[r.inventory_item_id] = r.purchase_rate;
            }
            setHistoricalPurchaseRates(rateMap);
            setLoadingHistoricalRates(false);
          }
        })
        .catch((e) => {
          if (active) {
            setLoadingHistoricalRates(false);
            console.error("Failed to load historical purchase rates", e);
          }
        });
      return () => {
        active = false;
      };
    }
  }, [activeTab, purchaseRateHistoryDate, isTodayPurchaseRate]);

  useEffect(() => {
    itemsCursorRef.current = itemsCursor;
  }, [itemsCursor]);

  useEffect(() => {
    itemsHasMoreRef.current = itemsHasMore;
  }, [itemsHasMore]);

  useEffect(() => {
    itemsLoadingRef.current = itemsLoading;
  }, [itemsLoading]);

  useEffect(() => {
    itemsLoadingMoreRef.current = itemsLoadingMore;
  }, [itemsLoadingMore]);

  useEffect(() => {
    stockCursorRef.current = stockCursor;
  }, [stockCursor]);

  useEffect(() => {
    stockHasMoreRef.current = stockHasMore;
  }, [stockHasMore]);

  useEffect(() => {
    stockLoadingRef.current = stockLoading;
  }, [stockLoading]);

  useEffect(() => {
    stockLoadingMoreRef.current = stockLoadingMore;
  }, [stockLoadingMore]);

  useEffect(() => {
    stockLoadedShopIdRef.current = stockLoadedShopId;
  }, [stockLoadedShopId]);

  useEffect(() => {
    movementsLoadingRef.current = movementsLoading;
  }, [movementsLoading]);

  useEffect(() => {
    movementsLoadedKeyRef.current = movementsLoadedKey;
  }, [movementsLoadedKey]);

  const loadInventoryRows = useCallback(async ({
    append = false,
  }: {
    append?: boolean;
  } = {}) => {
    if (
      append &&
      (!itemsHasMoreRef.current || itemsLoadingMoreRef.current || itemsLoadingRef.current)
    ) {
      return;
    }

    itemsAbortRef.current?.abort();
    const controller = new AbortController();
    itemsAbortRef.current = controller;
    const requestId = ++itemsRequestIdRef.current;
    const inventorySearch = debouncedSearchRef.current.trim();

    if (append) {
      itemsLoadingMoreRef.current = true;
      setItemsLoadingMore(true);
    } else {
      itemsLoadingRef.current = true;
      setItemsLoading(true);
    }
    setErrorMessage(null);

    try {
      const rowParams = {
        q: inventorySearch || undefined,
        limit: INVENTORY_ITEM_PAGE_SIZE,
        cursor_sort_order: append ? itemsCursorRef.current.sortOrder : undefined,
        cursor_name: append ? itemsCursorRef.current.name : undefined,
        cursor_id: append ? itemsCursorRef.current.id : undefined,
      };
      const [page, counts] = await Promise.all([
        fetchInventoryItemRows(rowParams, { signal: controller.signal }),
        append
          ? Promise.resolve(null)
          : fetchInventoryItemCounts(
            { q: inventorySearch || undefined },
            { signal: controller.signal },
          ),
      ]);

      if (controller.signal.aborted || requestId !== itemsRequestIdRef.current) {
        return;
      }

      setItems((currentItems) => {
        if (!append) {
          return page.items;
        }
        const existingIds = new Set(currentItems.map((item) => item.id));
        return [...currentItems, ...page.items.filter((item) => !existingIds.has(item.id))];
      });
      setItemsHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      itemsCursorRef.current = nextCursor;
      setItemsCursor(nextCursor);
      itemsHasMoreRef.current = page.has_more;
      if (counts) {
        setItemsTotalCount(counts.all);
      } else if (!append) {
        setItemsTotalCount(page.items.length);
      }
      loadedItemsQueryRef.current = inventorySearch;
    } catch (error) {
      if (isApiRequestCanceled(error)) {
        return;
      }
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, append ? "Unable to load more inventory items." : "Unable to load inventory items."));
    } finally {
      if (itemsAbortRef.current === controller) {
        itemsAbortRef.current = null;
      }
      if (requestId === itemsRequestIdRef.current) {
        itemsLoadingRef.current = false;
        itemsLoadingMoreRef.current = false;
        setItemsLoading(false);
        setItemsLoadingMore(false);
      }
    }
  }, []);

  const loadBaseData = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const [nextCategories, nextShops] = await Promise.all([
        fetchInventoryCategories(),
        fetchShops(),
      ]);
      setCategories(nextCategories);
      setShops(nextShops);
      setSelectedShopId((currentShopId) =>
        currentShopId && nextShops.some((shop) => shop.id === currentShopId)
          ? currentShopId
          : nextShops[0]?.id ?? null,
      );
      if (nextShops.length === 0) {
        setStockItems([]);
        setStockLoadedShopId(null);
        stockLoadedShopIdRef.current = null;
        setMovements([]);
        movementsLoadedKeyRef.current = null;
        setMovementsLoadedKey(null);
      }
      setBaseLoaded(true);
      setBaseReloadKey((current) => current + 1);
      stockLoadedShopIdRef.current = null;
      setStockLoadedShopId(null);
      void loadInventoryRows();
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load inventory."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadInventoryRows]);

  const loadShopData = useCallback(async (shopId: UUID) => {
    stockAbortRef.current?.abort();
    const controller = new AbortController();
    stockAbortRef.current = controller;
    const requestId = ++stockRequestIdRef.current;
    stockLoadingRef.current = true;
    setStockLoading(true);
    setStockLoadingMore(false);
    setErrorMessage(null);
    try {
      const page = await fetchShopInventoryAllocationRows(
        shopId,
        { limit: INVENTORY_STOCK_PAGE_SIZE },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || requestId !== stockRequestIdRef.current) {
        return;
      }
      setStockItems(page.items);
      setStockHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      stockCursorRef.current = nextCursor;
      stockHasMoreRef.current = page.has_more;
      stockLoadedShopIdRef.current = shopId;
      setStockCursor(nextCursor);
      setStockLoadedShopId(shopId);
    } catch (error) {
      if (isApiRequestCanceled(error)) {
        return;
      }
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load branch inventory."));
    } finally {
      if (stockAbortRef.current === controller) {
        stockAbortRef.current = null;
      }
      if (requestId === stockRequestIdRef.current) {
        stockLoadingRef.current = false;
        stockLoadingMoreRef.current = false;
        setStockLoading(false);
        setStockLoadingMore(false);
      }
    }
  }, []);

  const loadMoreShopData = useCallback(async () => {
    const shopId = stockLoadedShopIdRef.current;
    if (
      !shopId ||
      !stockHasMoreRef.current ||
      stockLoadingRef.current ||
      stockLoadingMoreRef.current
    ) {
      return;
    }
    stockLoadingMoreRef.current = true;
    setStockLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchShopInventoryAllocationRows(shopId, {
        limit: INVENTORY_STOCK_PAGE_SIZE,
        cursor_sort_order: stockCursorRef.current.sortOrder,
        cursor_name: stockCursorRef.current.name,
        cursor_id: stockCursorRef.current.id,
      });
      if (shopId !== stockLoadedShopIdRef.current) {
        return;
      }
      setStockItems((currentItems) => {
        const existingIds = new Set(currentItems.map((item) => item.id));
        return [...currentItems, ...page.items.filter((item) => !existingIds.has(item.id))];
      });
      setStockHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      stockCursorRef.current = nextCursor;
      stockHasMoreRef.current = page.has_more;
      setStockCursor(nextCursor);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load more branch inventory."));
    } finally {
      stockLoadingMoreRef.current = false;
      setStockLoadingMore(false);
    }
  }, []);

  const loadMovements = useCallback(async (
    shopId: UUID,
    historyParams: typeof movementHistoryParams,
    historyKey: string,
  ) => {
    if (movementsLoadingRef.current) {
      return;
    }
    movementsLoadingRef.current = true;
    setMovementsLoading(true);
    setErrorMessage(null);
    try {
      const [nextMovements, nextRetailerUsages] = await Promise.all([
        fetchAdminInventoryMovements({
          shop_id: shopId,
          reference_date: historyParams.reference_date,
          range_start_date: historyParams.range_start_date,
          range_end_date: historyParams.range_end_date,
          limit: 100,
        }),
        fetchAdminRetailerInventoryUsages({
          shop_id: shopId,
          reference_date: historyParams.reference_date,
          range_start_date: historyParams.range_start_date,
          range_end_date: historyParams.range_end_date,
          limit: 100,
        }),
      ]);
      setMovements(nextMovements.items);
      setRetailerUsages(nextRetailerUsages.items);
      movementsLoadedKeyRef.current = historyKey;
      setMovementsLoadedKey(historyKey);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load movement history."));
    } finally {
      movementsLoadingRef.current = false;
      setMovementsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadBaseData();
    return undefined;
  }, [loadBaseData]));

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    debouncedSearchRef.current = debouncedSearch;
  }, [debouncedSearch]);

  useEffect(() => {
    if (!baseLoaded || loadedItemsQueryRef.current === debouncedSearch) {
      return;
    }
    void loadInventoryRows();
  }, [baseLoaded, debouncedSearch, loadInventoryRows]);

  useEffect(() => {
    setBranchDropdownOpen(false);
    setMovementHistoryOpen(false);
  }, [activeTab]);

  useEffect(() => {
    setMovementHistoryOpen(false);
    setMovements([]);
    movementsLoadedKeyRef.current = null;
    setMovementsLoadedKey(null);
    setStockItems([]);
    stockCursorRef.current = EMPTY_INVENTORY_CURSOR;
    stockHasMoreRef.current = false;
    stockLoadedShopIdRef.current = null;
    setStockCursor(EMPTY_INVENTORY_CURSOR);
    setStockHasMore(false);
    setStockLoadedShopId(null);
  }, [selectedShopId]);

  useEffect(() => {
    setMovements([]);
    movementsLoadedKeyRef.current = null;
    setMovementsLoadedKey(null);
  }, [movementHistoryKey]);

  useEffect(() => {
    if (!movementHistoryOpen || !selectedShopId || !movementHistoryKey || movementsLoadedKey === movementHistoryKey) {
      return;
    }
    void loadMovements(selectedShopId, movementHistoryParams, movementHistoryKey);
  }, [
    loadMovements,
    movementHistoryKey,
    movementHistoryOpen,
    movementHistoryParams,
    movementsLoadedKey,
    selectedShopId,
  ]);

  useEffect(() => {
    if (activeTab !== "shops" || !selectedShopId || !baseLoaded) {
      return;
    }
    if (stockLoadedShopId === selectedShopId && stockItems.length > 0) {
      return;
    }
    void loadShopData(selectedShopId);
  }, [activeTab, baseLoaded, baseReloadKey, loadShopData, selectedShopId, stockItems.length, stockLoadedShopId]);

  const openCreateEditor = useCallback(() => {
    navigation.navigate("AdminInventoryItemEditor");
  }, [navigation]);

  const selectMovementHistoryDate = useCallback((selectedDate: string) => {
    if (movementCalendarTarget === "date") {
      setMovementHistoryDate(selectedDate);
    } else if (movementCalendarTarget === "start") {
      setMovementHistoryRangeStart(selectedDate);
      setMovementHistoryRangeEnd((currentEnd) => currentEnd < selectedDate ? selectedDate : currentEnd);
    } else if (movementCalendarTarget === "end") {
      setMovementHistoryRangeEnd(selectedDate);
      setMovementHistoryRangeStart((currentStart) => currentStart > selectedDate ? selectedDate : currentStart);
    }
    setMovementCalendarTarget(null);
  }, [movementCalendarTarget]);

  const openEditEditor = useCallback((item: InventoryItemRead) => {
    navigation.navigate("AdminInventoryItemEditor", { itemId: item.id, initialItem: item });
  }, [navigation]);

  const confirmDeleteItem = useCallback((item: InventoryItemRead) => {
    Alert.alert("Delete inventory item", `Delete ${item.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteInventoryItem(item.id)
            .then(() => loadBaseData(true))
            .catch((error) => {
              triggerHaptic();
              setErrorMessage(getRequestMessage(error, "Unable to delete inventory item."));
            });
        },
      },
    ]);
  }, [loadBaseData]);

  const saveCategory = useCallback(async () => {
    const name = categoryDraft.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await createInventoryCategory({ name });
      setCategoryDraft("");
      await loadBaseData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to save inventory category."));
    } finally {
      setSaving(false);
    }
  }, [categoryDraft, loadBaseData]);

  const saveCategoryRename = useCallback(async (category: InventoryCategoryRead) => {
    const name = editingCategoryName.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateInventoryCategory(category.id, { name });
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await loadBaseData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to rename inventory category."));
    } finally {
      setSaving(false);
    }
  }, [editingCategoryName, loadBaseData]);

  const confirmDeleteCategory = useCallback((category: InventoryCategoryRead) => {
    Alert.alert("Delete inventory category", `Delete ${category.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteInventoryCategory(category.id)
            .then(() => loadBaseData(true))
            .catch((error) => {
              triggerHaptic();
              setErrorMessage(getRequestMessage(error, "Unable to delete inventory category."));
            });
        },
      },
    ]);
  }, [loadBaseData]);

  const allocateItem = useCallback(async (itemId: UUID) => {
    if (!selectedShopId) {
      return;
    }
    if (allocationBusyItemId) {
      return;
    }
    const shopId = selectedShopId;
    setAllocationBusyItemId(itemId);
    setErrorMessage(null);
    try {
      await allocateShopInventoryItems(shopId, [itemId]);
      if (stockLoadedShopIdRef.current === shopId) {
        setStockItems((currentItems) => markInventoryItemAllocated(currentItems, itemId));
      }
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to allocate inventory item."));
    } finally {
      setAllocationBusyItemId(null);
    }
  }, [allocationBusyItemId, selectedShopId]);

  const toggleAllocation = useCallback(async (item: InventoryItemStockRead) => {
    if (!selectedShopId) {
      return;
    }
    if (allocationBusyItemId || !item.is_active) {
      return;
    }
    setAllocationBusyItemId(item.id);
    setErrorMessage(null);
    try {
      const changedItem = await updateShopInventoryAllocation(selectedShopId, {
        item_id: item.id,
        is_active: !item.allocation_active,
      });
      setStockItems((currentItems) => patchStockItem(currentItems, changedItem));
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update inventory allocation."));
    } finally {
      setAllocationBusyItemId(null);
    }
  }, [allocationBusyItemId, selectedShopId]);

  const handleSaveStockValue = useCallback(async () => {
    if (!editingStockKey || !selectedShopId) return;
    const parts = editingStockKey.split(":");
    const itemId = parts[0];
    const type = parts[1];
    const categoryId = parts[2];
    const numValue = parseFloat(editingStockValue) || 0;
    const strValue = numValue.toString();

    setEditingStockKey(null);
    setErrorMessage(null);

    try {
      if (type === "retailer") {
        const updatedItem = await adminSetRetailerInventoryStock(selectedShopId, itemId, {
          retailer_used_quantity: strValue,
          category_id: categoryId ?? null,
        });
        setStockItems((currentItems) => currentItems.map((item) => (item.id === itemId ? updatedItem : item)));
        return;
      }

      const payload: Record<string, string | null> = {};
      if (type === "available") {
        payload.available_quantity = strValue;
      } else if (type === "used") {
        payload.used_quantity = strValue;
      } else {
        payload.used_quantity = strValue;
        payload.category_id = type;
      }

      const updatedItem = await adminSetShopInventoryStock(selectedShopId, itemId, payload);
      setStockItems((currentItems) => currentItems.map((item) => (item.id === itemId ? updatedItem : item)));
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to save stock value."));
    }
  }, [editingStockKey, editingStockValue, selectedShopId]);

  const toggleStockEdit = useCallback((key: string, currentValue: string) => {
    if (editingStockKey === key) {
      handleSaveStockValue();
    } else {
      setEditingStockKey(key);
      setEditingStockValue(currentValue);
    }
  }, [editingStockKey, handleSaveStockValue]);

  const handleSavePurchaseRate = useCallback(async (itemId: UUID) => {
    const nextRate = editingPurchaseRateValue.trim();
    if (!nextRate || money(nextRate).lessThan(0)) {
      Alert.alert("Invalid purchase rate", "Enter a valid amount.");
      return;
    }
    setSavingPurchaseRateId(itemId);
    setErrorMessage(null);
    try {
      const updatedItem = await updateInventoryItemPurchaseRate(itemId, money(nextRate).toFixed(2));
      setItems((currentItems) => currentItems.map((item) => (item.id === itemId ? updatedItem : item)));
      setEditingPurchaseRateId(null);
      setEditingPurchaseRateValue("");
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update purchase rate."));
    } finally {
      setSavingPurchaseRateId(null);
    }
  }, [editingPurchaseRateValue]);

  const togglePurchaseRateEdit = useCallback((item: InventoryItemRead) => {
    if (editingPurchaseRateId === item.id) {
      void handleSavePurchaseRate(item.id);
      return;
    }
    setEditingPurchaseRateId(item.id);
    setEditingPurchaseRateValue(item.purchase_rate ?? "0");
  }, [editingPurchaseRateId, handleSavePurchaseRate]);

  const handleSaveAllPurchaseRates = useCallback(async () => {
    setSavingAllPurchaseRates(true);
    setErrorMessage(null);
    try {
      if (editingPurchaseRateId) {
        const nextRate = editingPurchaseRateValue.trim();
        if (!nextRate || money(nextRate).lessThan(0)) {
          Alert.alert("Invalid purchase rate", "Enter a valid amount before saving.");
          return;
        }
        await updateInventoryItemPurchaseRate(editingPurchaseRateId, money(nextRate).toFixed(2));
        setEditingPurchaseRateId(null);
        setEditingPurchaseRateValue("");
      }
      await confirmInventoryPurchaseRatesToday();
      await loadInventoryRows();
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to save today's purchase rates."));
    } finally {
      setSavingAllPurchaseRates(false);
    }
  }, [editingPurchaseRateId, editingPurchaseRateValue, loadInventoryRows]);

  const renderTabs = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
      <View style={[styles.tabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
        {[
          { key: "items", label: "Items", icon: "package-variant-closed" },
          { key: "categories", label: "Categories", icon: "shape-outline" },
          { key: "purchaseRates", label: "Purchase rate", icon: "currency-inr" },
          { key: "shops", label: "Branch stock", icon: "storefront-outline" },
          { key: "transferShops", label: "Transfer shops", icon: "swap-horizontal" },
        ].map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => setActiveTab(tab.key as InventoryTab)}
            style={[styles.tab, { backgroundColor: active ? palette.card : "transparent" }]}
          >
            <MaterialCommunityIcons
              name={tab.icon as never}
              size={16}
              color={active ? palette.inventoryStrong : palette.textMuted}
            />
            <Text style={[styles.tabText, { color: active ? palette.inventoryStrong : palette.textMuted }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
      </View>
    </ScrollView>
  );

  const renderItemsHeader = () => null;



  const renderInventoryItemRow = ({ item }: { item: InventoryItemRead }) => {
    const billingNames = inventoryItemBillingNames(item);
    return (
      <View style={[styles.itemRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <ItemThumbnail
          uri={getItemThumbnailUri(item)}
          recyclingKey={item.id}
          size={52}
          borderRadius={10}
          backgroundColor={palette.surfaceMuted}
          icon="package-variant-closed"
          iconColor={palette.textMuted}
        />
        <View style={styles.itemText}>
          <Text style={[styles.itemName, { color: palette.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.itemSub, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
          <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
            {item.base_unit.toUpperCase()} · {inventoryItemCategoryLabel(item)}
          </Text>
          <View style={styles.mappingSummary}>
            <View style={styles.mappingHeader}>
              <MaterialCommunityIcons
                name={billingNames.length > 0 ? "link-variant" : "link-off"}
                size={14}
                color={billingNames.length > 0 ? palette.inventory : palette.textMuted}
              />
              <Text style={[styles.mappingLabel, { color: palette.textMuted }]}>Billing</Text>
            </View>
            {billingNames.length === 0 ? (
              <Text style={[styles.mappingEmpty, { color: palette.textMuted }]}>Not mapped</Text>
            ) : (
              <View style={styles.mappingChips}>
                {billingNames.map((billingName, index) => (
                  <View
                    key={`${billingName}-${index}`}
                    style={[styles.mappingChip, { backgroundColor: palette.inventorySoft }]}
                  >
                    <Text style={[styles.mappingChipText, { color: palette.inventoryStrong }]}>
                      {billingName}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
        <View style={styles.rowActions}>
          <IconButton icon="pencil-outline" label="Edit" tone="info" palette={palette} onPress={() => openEditEditor(item)} />
          <IconButton icon="delete-outline" label="Delete" tone="danger" palette={palette} onPress={() => confirmDeleteItem(item)} />
        </View>
      </View>
    );
  };

  const renderPurchaseRateHeader = () => (
    <View style={styles.itemsHeader}>
      {/* Intro — only shown in today mode */}
      {isTodayPurchaseRate && (
        <Text style={[styles.purchaseRateIntro, { color: palette.textSecondary }]}>
          Set today&apos;s purchase rate for each item, then tap Save to confirm.
        </Text>
      )}

      {/* History date control */}
      <View style={[styles.historyBar, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <View style={[styles.historyBarIcon, { backgroundColor: palette.inventorySoft }]}>
          <MaterialCommunityIcons
            name={isTodayPurchaseRate ? "currency-inr" : "history"}
            size={16}
            color={palette.inventoryStrong}
          />
        </View>
        <View style={styles.historyBarContent}>
          <Text style={[styles.historyBarLabel, { color: palette.textMuted }]}>
            {isTodayPurchaseRate ? "VIEWING" : "HISTORY"}
          </Text>
          <Pressable
            onPress={() => setPurchaseRateCalendarOpen(true)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={[styles.historyDateBtnText, { color: palette.textPrimary }]}>
              {isTodayPurchaseRate ? "Today" : formatCalendarDateLabel(purchaseRateHistoryDate)}
            </Text>
          </Pressable>
        </View>
        {!isTodayPurchaseRate ? (
          <Pressable
            onPress={() => setPurchaseRateHistoryDate(toDateInputValue(new Date()))}
            style={[styles.historyBarBadge, { backgroundColor: palette.inventory }]}
          >
            <MaterialCommunityIcons name="calendar-today" size={12} color={palette.onPrimary} />
            <Text style={[styles.historyBarBadgeText, { color: palette.onPrimary }]}>Today</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setPurchaseRateCalendarOpen(true)}
            style={[styles.historyBarBadge, { backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.border }]}
          >
            <MaterialCommunityIcons name="history" size={12} color={palette.textSecondary} />
            <Text style={[styles.historyBarBadgeText, { color: palette.textSecondary }]}>History</Text>
          </Pressable>
        )}
      </View>

      {/* Search + Save — only in today mode */}
      {isTodayPurchaseRate && (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search inventory"
              palette={palette}
            />
          </View>
          <ActionButton
            label={savingAllPurchaseRates ? "Saving..." : "Save"}
            icon="calendar-check-outline"
            palette={palette}
            active
            loading={savingAllPurchaseRates}
            disabled={items.length === 0 || savingAllPurchaseRates || Boolean(savingPurchaseRateId)}
            onPress={() => void handleSaveAllPurchaseRates()}
          />
        </View>
      )}
    </View>
  );

  const renderPurchaseRateRow = ({ item }: { item: InventoryItemRead }) => {
    const editing = editingPurchaseRateId === item.id;
    const saving = savingPurchaseRateId === item.id;
    const updatedToday = isPurchaseRateUpdatedToday(item.updated_at);
    const historicalRate = !isTodayPurchaseRate ? historicalPurchaseRates[item.id] : null;
    const hasHistoricalRate = historicalRate != null;
    
    return (
      <View style={[styles.prRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
        {/* Left: thumbnail + item info */}
        <ItemThumbnail
          uri={getItemThumbnailUri(item)}
          recyclingKey={item.id}
          size={48}
          borderRadius={10}
          backgroundColor={palette.surfaceMuted}
          icon="package-variant-closed"
          iconColor={palette.textMuted}
        />
        <View style={styles.prInfo}>
          <Text style={[styles.itemName, { color: palette.textPrimary }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.itemSub, { color: palette.textSecondary }]} numberOfLines={1}>{item.tamil_name}</Text>
          <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
            {item.base_unit.toUpperCase()} · {inventoryItemCategoryLabel(item)}
          </Text>
          {isTodayPurchaseRate && (
            <View
              style={[
                styles.prStatusPill,
                {
                  backgroundColor: updatedToday ? palette.inventorySoft : palette.dangerSoft,
                },
              ]}
            >
              <View
                style={[
                  styles.prStatusDot,
                  { backgroundColor: updatedToday ? palette.inventoryStrong : palette.danger },
                ]}
              />
              <Text style={[styles.prStatusText, { color: updatedToday ? palette.inventoryStrong : palette.danger }]}>
                {updatedToday ? "Updated today" : "Needs update"}
              </Text>
            </View>
          )}
        </View>

        {/* Right: rate panel */}
        <View style={[styles.prPanel, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.prPanelLabel, { color: palette.textMuted }]}>RATE</Text>
          {saving ? (
            <ActivityIndicator size="small" color={palette.inventory} style={{ marginVertical: 4 }} />
          ) : editing ? (
            <TextInput
              value={editingPurchaseRateValue}
              onChangeText={setEditingPurchaseRateValue}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={palette.textMuted}
              style={[styles.prPanelValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.inventory, minWidth: 70 }]}
              onSubmitEditing={() => void handleSavePurchaseRate(item.id)}
              autoFocus
            />
          ) : !isTodayPurchaseRate ? (
            loadingHistoricalRates ? (
              <ActivityIndicator size="small" color={palette.textMuted} style={{ marginVertical: 4 }} />
            ) : (
              <Text style={[styles.prPanelValue, { color: hasHistoricalRate ? palette.textPrimary : palette.textMuted }]}>
                {hasHistoricalRate ? formatPurchaseRate(historicalRate, item.base_unit) : "—"}
              </Text>
            )
          ) : (
            <Text style={[styles.prPanelValue, { color: palette.textPrimary }]}>
              {formatPurchaseRate(item.purchase_rate ?? "0", item.base_unit)}
            </Text>
          )}
          {isTodayPurchaseRate && !saving && (
            <Pressable
              onPress={() => togglePurchaseRateEdit(item)}
              disabled={saving}
              hitSlop={8}
              style={[styles.prEditBtn, { backgroundColor: editing ? palette.inventory : palette.border }]}
            >
              <MaterialCommunityIcons
                name={editing ? "check" : "pencil-outline"}
                size={13}
                color={editing ? palette.onPrimary : palette.textSecondary}
              />
              <Text style={[styles.prEditBtnText, { color: editing ? palette.onPrimary : palette.textSecondary }]}>
                {editing ? "Save" : "Edit"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderItemsFooter = () => {
    if (itemsLoadingMore) {
      return (
        <View style={styles.listFooter}>
          <ActivityIndicator color={palette.inventory} />
        </View>
      );
    }
    if (!itemsHasMore && items.length > 0) {
      return (
        <Text style={[styles.itemCountText, { color: palette.textMuted }]}>
          {items.length} of {itemsTotalCount || items.length} inventory items
        </Text>
      );
    }
    return <View style={styles.listFooterSpacer} />;
  };

  const renderCategories = () => (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <SearchField
            value={categoryDraft}
            onChangeText={setCategoryDraft}
            placeholder="New category"
            palette={palette}
          />
        </View>
        <ActionButton label="Save" icon="content-save-outline" palette={palette} tone="primary" active loading={saving} onPress={() => void saveCategory()} />
      </View>
      {categories.map((category) => {
        const editing = editingCategoryId === category.id;
        return (
          <View key={category.id} style={[styles.itemRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <MaterialCommunityIcons name="shape-outline" size={22} color={palette.inventory} />
            {editing ? (
              <TextInput
                value={editingCategoryName}
                onChangeText={setEditingCategoryName}
                style={[styles.renameInput, { color: palette.textPrimary, borderColor: palette.border }]}
              />
            ) : (
              <Text style={[styles.itemName, styles.flex, { color: palette.textPrimary }]}>{category.name}</Text>
            )}
            <View style={styles.rowActions}>
              {editing ? (
                <>
                  <IconButton icon="check" label="Save" tone="primary" palette={palette} onPress={() => void saveCategoryRename(category)} />
                  <IconButton icon="close" label="Cancel" tone="warning" palette={palette} onPress={() => setEditingCategoryId(null)} />
                </>
              ) : (
                <>
                  <IconButton
                    icon="pencil-outline"
                    label="Rename"
                    palette={palette}
                    onPress={() => {
                      setEditingCategoryId(category.id);
                      setEditingCategoryName(category.name);
                    }}
                  />
                  <IconButton icon="delete-outline" label="Delete" tone="danger" palette={palette} onPress={() => confirmDeleteCategory(category)} />
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );

  const renderShopStockHeader = () => (
    <View style={styles.section}>
      <View style={styles.dropdownWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select branch stock"
          accessibilityState={{ expanded: branchDropdownOpen, disabled: shops.length === 0 }}
          disabled={shops.length === 0}
          onPress={() => setBranchDropdownOpen((current) => !current)}
          style={[
            styles.branchSelect,
            {
              borderColor: branchDropdownOpen ? palette.inventory : palette.border,
              backgroundColor: palette.card,
              opacity: shops.length === 0 ? 0.65 : 1,
            },
          ]}
        >
          <View style={[styles.branchSelectIcon, { backgroundColor: palette.inventorySoft }]}>
            <MaterialCommunityIcons name="storefront-outline" size={18} color={palette.inventory} />
          </View>
          <View style={styles.branchSelectText}>
            <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>Branch</Text>
            <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
              {selectedShop?.name ?? "Select branch"}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={branchDropdownOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color={palette.textMuted}
          />
        </Pressable>
        {branchDropdownOpen ? (
          <View style={[styles.dropdownMenu, { borderColor: palette.border, backgroundColor: palette.card }]}>
            {shops.map((shop) => {
              const active = shop.id === selectedShopId;
              return (
                <Pressable
                  key={shop.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setSelectedShopId(shop.id);
                    setBranchDropdownOpen(false);
                  }}
                  style={[
                    styles.dropdownOption,
                    {
                      backgroundColor: active ? palette.inventorySoft : "transparent",
                      borderColor: active ? palette.inventory : "transparent",
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={active ? "store-check-outline" : "storefront-outline"}
                    size={17}
                    color={active ? palette.inventory : palette.textMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.dropdownOptionText, { color: active ? palette.inventoryStrong : palette.textPrimary }]}
                  >
                    {shop.name}
                  </Text>
                  {active ? <MaterialCommunityIcons name="check" size={18} color={palette.inventory} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
        {selectedShop?.name ?? "Select branch"}
      </Text>
      {stockLoading && stockItems.length === 0 ? (
        <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading branch inventory...</Text>
      ) : null}
    </View>
  );

  const renderStockItemRow = ({ item }: { item: InventoryItemStockRead }) => {
    const busy = allocationBusyItemId === item.id;
    const allocationDisabled = Boolean(allocationBusyItemId && !busy);
    const categoryUsage = Array.isArray(item.category_usage) ? item.category_usage : [];
    return (
      <View style={[styles.stockItemCard, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <View style={styles.stockItemHeader}>
          <ItemThumbnail
            uri={getItemThumbnailUri(item)}
            recyclingKey={item.id}
            size={48}
            borderRadius={10}
            backgroundColor={palette.surfaceMuted}
            icon="warehouse"
            iconColor={palette.textMuted}
          />
          <View style={styles.itemText}>
            <Text style={[styles.itemName, { color: palette.textPrimary }]}>{item.name}</Text>
            <View style={styles.itemQuantityRow}>
              <View style={styles.itemQuantityGroup}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Available</Text>
                  <Pressable onPress={() => toggleStockEdit(`${item.id}:available`, item.available_quantity)} hitSlop={10}>
                    <MaterialCommunityIcons name={editingStockKey === `${item.id}:available` ? "check" : "pencil-outline"} size={14} color={palette.textMuted} />
                  </Pressable>
                </View>
                {editingStockKey === `${item.id}:available` ? (
                  <TextInput
                    value={editingStockValue}
                    onChangeText={setEditingStockValue}
                    keyboardType="numeric"
                    style={[styles.quantityValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.border, minWidth: 60, padding: 0 }]}
                    onSubmitEditing={handleSaveStockValue}
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                    {formatInventoryQuantity(item.available_quantity, item.base_unit)}
                  </Text>
                )}
              </View>
              <View style={styles.itemQuantityGroup}>
                <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Transfer</Text>
                <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                  {formatInventoryQuantity(item.transfer_stock ?? "0", item.base_unit)}
                </Text>
              </View>
              <View style={styles.itemQuantityGroup}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Used</Text>
                  {categoryUsage.length === 0 && (
                    <Pressable onPress={() => toggleStockEdit(`${item.id}:used`, item.used_quantity)} hitSlop={10}>
                      <MaterialCommunityIcons name={editingStockKey === `${item.id}:used` ? "check" : "pencil-outline"} size={14} color={palette.textMuted} />
                    </Pressable>
                  )}
                </View>
                {editingStockKey === `${item.id}:used` ? (
                  <TextInput
                    value={editingStockValue}
                    onChangeText={setEditingStockValue}
                    keyboardType="numeric"
                    style={[styles.quantityValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.border, minWidth: 60, padding: 0 }]}
                    onSubmitEditing={handleSaveStockValue}
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                    {formatInventoryQuantity(item.used_quantity, item.base_unit)}
                  </Text>
                )}
              </View>
              <View style={styles.itemQuantityGroup}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Retailer</Text>
                  {categoryUsage.length === 0 && (
                    <Pressable onPress={() => toggleStockEdit(`${item.id}:retailer`, item.retailer_used_quantity ?? "0")} hitSlop={10}>
                      <MaterialCommunityIcons name={editingStockKey === `${item.id}:retailer` ? "check" : "pencil-outline"} size={14} color={palette.textMuted} />
                    </Pressable>
                  )}
                </View>
                {editingStockKey === `${item.id}:retailer` ? (
                  <TextInput
                    value={editingStockValue}
                    onChangeText={setEditingStockValue}
                    keyboardType="numeric"
                    style={[styles.quantityValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.border, minWidth: 60, padding: 0 }]}
                    onSubmitEditing={handleSaveStockValue}
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                    {formatInventoryQuantity(item.retailer_used_quantity ?? "0", item.base_unit)}
                  </Text>
                )}
              </View>
            </View>
          </View>
          {!item.is_active ? (
            <ActionButton
              label="Inactive"
              icon="cancel"
              palette={palette}
              tone="neutral"
              disabled
              onPress={() => undefined}
            />
          ) : item.allocated ? (
            <ActionButton
              label={item.allocation_active ? "Pause" : "Activate"}
              icon={item.allocation_active ? "pause-circle-outline" : "play-circle-outline"}
              palette={palette}
              tone={item.allocation_active ? "warning" : "success"}
              active
              loading={busy}
              disabled={allocationDisabled}
              onPress={() => void toggleAllocation(item)}
            />
          ) : (
            <ActionButton
              label="Allocate"
              icon="link-variant-plus"
              palette={palette}
              tone="success"
              active
              loading={busy}
              disabled={allocationDisabled}
              onPress={() => void allocateItem(item.id)}
            />
          )}
        </View>
        {categoryUsage.length > 0 ? (
          <View style={[styles.categoryUsageList, { borderTopColor: palette.border }]}>
            {categoryUsage.map((category) => (
              <View
                key={category.category_id}
                style={[
                  styles.categoryUsageRow,
                  { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
                ]}
              >
                <Text numberOfLines={1} style={[styles.categoryUsageName, { color: palette.textPrimary }]}>
                  {category.category_name}
                </Text>
                <View style={styles.categoryUsageTotals}>
                  <View style={styles.categoryUsageTotal}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={[styles.categoryUsageLabel, { color: palette.textMuted }]}>Used</Text>
                      <Pressable onPress={() => toggleStockEdit(`${item.id}:${category.category_id}`, category.used_quantity)} hitSlop={10}>
                        <MaterialCommunityIcons name={editingStockKey === `${item.id}:${category.category_id}` ? "check" : "pencil-outline"} size={14} color={palette.textMuted} />
                      </Pressable>
                    </View>
                    {editingStockKey === `${item.id}:${category.category_id}` ? (
                      <TextInput
                        value={editingStockValue}
                        onChangeText={setEditingStockValue}
                        keyboardType="numeric"
                        style={[styles.categoryUsageValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.border, minWidth: 60, padding: 0 }]}
                        onSubmitEditing={handleSaveStockValue}
                        autoFocus
                      />
                    ) : (
                      <Text style={[styles.categoryUsageValue, { color: palette.textPrimary }]}>
                        {formatInventoryQuantity(category.used_quantity, item.base_unit)}
                      </Text>
                    )}
                  </View>
                  <View style={styles.categoryUsageTotal}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={[styles.categoryUsageLabel, { color: palette.textMuted }]}>Retailer</Text>
                      <Pressable onPress={() => toggleStockEdit(`${item.id}:retailer:${category.category_id}`, category.retailer_used_quantity ?? "0")} hitSlop={10}>
                        <MaterialCommunityIcons name={editingStockKey === `${item.id}:retailer:${category.category_id}` ? "check" : "pencil-outline"} size={14} color={palette.textMuted} />
                      </Pressable>
                    </View>
                    {editingStockKey === `${item.id}:retailer:${category.category_id}` ? (
                      <TextInput
                        value={editingStockValue}
                        onChangeText={setEditingStockValue}
                        keyboardType="numeric"
                        style={[styles.categoryUsageValue, { color: palette.textPrimary, borderBottomWidth: 1, borderBottomColor: palette.border, minWidth: 60, padding: 0 }]}
                        onSubmitEditing={handleSaveStockValue}
                        autoFocus
                      />
                    ) : (
                      <Text style={[styles.categoryUsageValue, { color: palette.textPrimary }]}>
                        {formatInventoryQuantity(category.retailer_used_quantity ?? "0", item.base_unit)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderShopStockFooter = () => (
    <View style={styles.section}>
      {stockLoadingMore ? (
        <View style={styles.listFooter}>
          <ActivityIndicator color={palette.inventory} />
        </View>
      ) : !stockHasMore && stockItems.length > 0 ? (
        <Text style={[styles.itemCountText, { color: palette.textMuted }]}>
          {stockItems.length} branch stock rows loaded
        </Text>
      ) : null}
      <View style={styles.historyToggleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: movementHistoryOpen }}
          onPress={() => setMovementHistoryOpen((current) => !current)}
          style={[
            styles.historyButton,
            {
              backgroundColor: movementHistoryOpen ? palette.card : palette.success,
              borderColor: palette.success,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={movementHistoryOpen ? "chevron-up" : "history"}
            size={20}
            color={movementHistoryOpen ? palette.success : palette.onPrimary}
          />
          <Text style={[styles.historyButtonText, { color: movementHistoryOpen ? palette.success : palette.onPrimary }]}>
            {movementHistoryOpen ? "Hide history" : "History"}
          </Text>
        </Pressable>
      </View>
      {movementHistoryOpen ? (
        <>
          <View style={[styles.historyFilterPanel, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <View style={styles.historyModeRow}>
              {[
                { key: "date" as const, label: "Date", icon: "calendar" as const },
                { key: "range" as const, label: "Range", icon: "calendar-range" as const },
              ].map((option) => {
                const active = movementHistoryMode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setMovementHistoryMode(option.key)}
                    style={[
                      styles.historyModeButton,
                      {
                        borderColor: active ? palette.inventory : palette.border,
                        backgroundColor: active ? palette.inventory : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={option.icon}
                      size={16}
                      color={active ? palette.onPrimary : palette.textMuted}
                    />
                    <Text style={[styles.historyModeText, { color: active ? palette.onPrimary : palette.textPrimary }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {movementHistoryMode === "date" ? (
              <CalendarDateField
                label="History date"
                value={movementHistoryDate}
                colors={movementCalendarColors}
                onPress={() => setMovementCalendarTarget("date")}
              />
            ) : (
              <View style={styles.historyDateRow}>
                <CalendarDateField
                  label="From"
                  value={movementHistoryRangeStart}
                  colors={movementCalendarColors}
                  icon="calendar-start"
                  onPress={() => setMovementCalendarTarget("start")}
                />
                <CalendarDateField
                  label="To"
                  value={movementHistoryRangeEnd}
                  colors={movementCalendarColors}
                  icon="calendar-end"
                  onPress={() => setMovementCalendarTarget("end")}
                />
              </View>
            )}
          </View>
          <View style={styles.historyModeRow}>
            {[
              { key: "movements" as const, label: "Stock Add/Use" },
              { key: "retailer" as const, label: "Retailer Stock" },
            ].map((option) => {
              const active = adminHistoryTab === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setAdminHistoryTab(option.key)}
                  style={[
                    styles.historyModeButton,
                    {
                      borderColor: active ? palette.inventory : palette.border,
                      backgroundColor: active ? palette.inventory : palette.surfaceMuted,
                    },
                  ]}
                >
                  <Text style={[styles.historyModeText, { color: active ? palette.onPrimary : palette.textPrimary }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            {adminHistoryTab === "retailer" ? "Retailer stock history" : "Movement history"}
          </Text>
          {movementsLoading ? (
            <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <ActivityIndicator color={palette.inventory} />
              <Text style={[styles.itemMeta, { color: palette.textMuted }]}>Loading movement history...</Text>
            </View>
          ) : adminHistoryTab === "retailer" ? (
            retailerUsages.length === 0 ? (
              <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
                <MaterialCommunityIcons name="store-outline" size={20} color={palette.textMuted} />
                <Text style={[styles.itemMeta, { color: palette.textMuted }]}>No retailer stock usage found.</Text>
              </View>
            ) : (
              retailerUsages.map((usage) => (
                <View key={usage.id} style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
                  <MaterialCommunityIcons name="store-outline" size={20} color="#B45309" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.itemName, { color: palette.textPrimary }]}>
                      {usage.inventory_item_name} · {usage.quantity} {usage.unit}
                    </Text>
                    <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
                      {usage.retailer_name ?? "—"} · {usage.category_name ?? "No category"}
                    </Text>
                    <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
                      {usage.created_by_name ? `By ${usage.created_by_name} · ` : ""}
                      {new Date(usage.occurred_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))
            )
          ) : movements.length === 0 ? (
            <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <MaterialCommunityIcons name="history" size={20} color={palette.textMuted} />
              <Text style={[styles.itemMeta, { color: palette.textMuted }]}>No stock movement found.</Text>
            </View>
          ) : (
            movements.map((movement) => (
              <View key={movement.id} style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
                <MaterialCommunityIcons
                  name={movement.movement_type === InventoryMovementType.ADD ? "plus-circle-outline" : "minus-circle-outline"}
                  size={20}
                  color={movement.movement_type === InventoryMovementType.ADD ? palette.success : palette.danger}
                />
                <View style={styles.itemText}>
                  <Text style={[styles.itemName, { color: palette.textPrimary }]}>{movement.inventory_item_name}</Text>
                  <Text style={[styles.itemMeta, { color: palette.textMuted }]}>{formatDateTime(movement.occurred_at)}</Text>
                  <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
                    {movement.movement_type === InventoryMovementType.ADD ? "Added" : `Used for ${movement.category_name ?? "category"}`} · {formatInventoryQuantity(movement.quantity, movement.unit)}
                  </Text>
                  {movement.movement_type === InventoryMovementType.ADD && (movement.driver_name || movement.vehicle_number) ? (
                    <View style={styles.movementTransportDetails}>
                      {movement.driver_name ? (
                        <Text selectable style={[styles.itemMeta, styles.movementTransportText, { color: palette.textMuted }]}>
                          Driver: {movement.driver_name.trim()}
                        </Text>
                      ) : null}
                      {movement.vehicle_number ? (
                        <Text
                          style={[styles.itemMeta, styles.movementTransportText, { color: palette.textPrimary }]}
                          textBreakStrategy={Platform.OS === "android" ? "simple" : undefined}
                        >
                          Vehicle: {movement.vehicle_number.trim()}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.onShell }]}>Inventory</Text>
          <Text style={[styles.subtitle, { color: palette.onShellMuted }]}>Items, categories, purchase rates, and branch stock</Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing}
          onRefresh={() => loadBaseData(true)}
        />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
      >
        <View style={styles.section}>{renderTabs()}</View>

        <View style={styles.flex}>
          {errorMessage ? (
            <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {activeTab === "items" && (
            <>
              <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
                <View style={[styles.row, { gap: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <SearchField
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search inventory"
                      palette={palette}
                    />
                  </View>
                  <ActionButton label="Add" icon="plus" palette={palette} tone="success" active onPress={openCreateEditor} />
                </View>
              </View>
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                renderItem={renderInventoryItemRow}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
                }
                contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
                ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
                ListHeaderComponent={renderItemsHeader}
                ListEmptyComponent={
                  !itemsLoading ? (
                    <EmptyStateCard
                      title="No items found"
                      subtitle="No inventory items found."
                      icon="package-variant-closed"
                      palette={palette}
                    />
                  ) : null
                }
                ListFooterComponent={renderItemsFooter}
                onEndReached={() => void loadInventoryRows({ append: true })}
                onEndReachedThreshold={0.35}
              />
            </>
          )}

          {activeTab === "purchaseRates" && (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={renderPurchaseRateRow}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
              }
              contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
              ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
              ListHeaderComponent={renderPurchaseRateHeader}
              ListEmptyComponent={
                !itemsLoading ? (
                  <EmptyStateCard
                    title="No items found"
                    subtitle="No inventory items found."
                    icon="package-variant-closed"
                    palette={palette}
                  />
                ) : null
              }
              ListFooterComponent={renderItemsFooter}
              onEndReached={() => void loadInventoryRows({ append: true })}
              onEndReachedThreshold={0.35}
            />
          )}

          {activeTab === "shops" && (
            <FlatList
              data={stockItems}
              keyExtractor={(item) => item.id}
              renderItem={renderStockItemRow}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
              }
              contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
              ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
              ListHeaderComponent={renderShopStockHeader}
              ListEmptyComponent={
                !stockLoading ? (
                  <EmptyStateCard
                    title="No branch stock"
                    subtitle="No branch stock rows found."
                    icon="warehouse"
                    palette={palette}
                  />
                ) : null
              }
              ListFooterComponent={renderShopStockFooter}
              onEndReached={() => void loadMoreShopData()}
              onEndReachedThreshold={0.35}
            />
          )}

          {activeTab === "categories" && (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
              }
              contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
            >
              {loading ? (
                <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading inventory...</Text>
              ) : (
                renderCategories()
              )}
            </ScrollView>
          )}

          {activeTab === "transferShops" && (
            <AdminTransferShopsTab />
          )}
        </View>
      </KeyboardAvoidingView>

      <CalendarDatePickerModal
        visible={movementCalendarTarget !== null}
        title={
          movementCalendarTarget === "start"
            ? "From"
            : movementCalendarTarget === "end"
              ? "To"
              : "History date"
        }
        value={
          movementCalendarTarget === "start"
            ? movementHistoryRangeStart
            : movementCalendarTarget === "end"
              ? movementHistoryRangeEnd
              : movementHistoryDate
        }
        rangeStartDate={movementHistoryMode === "range" ? movementHistoryRangeStart : null}
        rangeEndDate={movementHistoryMode === "range" ? movementHistoryRangeEnd : null}
        colors={movementCalendarColors}
        onSelect={selectMovementHistoryDate}
        onClose={() => setMovementCalendarTarget(null)}
      />

      <CalendarDatePickerModal
        visible={purchaseRateCalendarOpen}
        title="History date"
        value={purchaseRateHistoryDate}
        colors={movementCalendarColors}
        onSelect={(date) => {
          setPurchaseRateHistoryDate(date);
          setPurchaseRateCalendarOpen(false);
        }}
        onClose={() => setPurchaseRateCalendarOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardAvoid: { flex: 1 },
  topBar: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "900", letterSpacing: 0 },
  subtitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  content: { padding: 16, gap: 16 },
  tabsScroll: { flexGrow: 0 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 4, gap: 4 },
  tab: { minHeight: 42, borderRadius: 9, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 12 },
  tabText: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  section: { gap: 12 },
  itemsHeader: { gap: 12 },
  listSeparator: { height: 10 },
  listFooter: { minHeight: 56, alignItems: "center", justifyContent: "center" },
  listFooterSpacer: { height: 10 },
  itemCountText: { paddingVertical: 16, textAlign: "center", fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyToggleRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  historyButton: {
    width: "100%",
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  historyButtonText: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  historyFilterPanel: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  historyModeRow: { flexDirection: "row", gap: 8 },
  historyModeButton: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  historyModeText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  historyDateRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  itemRow: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stockItemCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  stockItemHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  categoryUsageList: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 7 },
  categoryUsageRow: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  categoryUsageName: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  categoryUsageTotals: { alignItems: "flex-end", gap: 5 },
  categoryUsageTotal: { alignItems: "flex-end", gap: 1 },
  categoryUsageLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  categoryUsageValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  movementRow: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  itemSub: { fontSize: 13, fontWeight: "700", letterSpacing: 0 },
  itemMeta: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  movementTransportDetails: { marginTop: 6, gap: 2 },
  movementTransportText: { flexShrink: 1, lineHeight: 18 },
  purchaseRateIntro: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  purchaseRateBlock: { marginTop: 8, gap: 4 },
  purchaseRateStatus: { fontSize: 11, fontWeight: "800", letterSpacing: 0 },
  mappingSummary: { marginTop: 8, gap: 6 },
  mappingHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  mappingLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  mappingEmpty: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  mappingChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mappingChip: { maxWidth: "100%", minHeight: 28, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  mappingChipText: { flexShrink: 1, fontSize: 12, fontWeight: "900", letterSpacing: 0, lineHeight: 16 },
  itemQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 3 },
  itemQuantityGroup: { gap: 1 },
  quantityLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  quantityValue: { fontSize: 16, fontWeight: "900", letterSpacing: 0 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontWeight: "700" },
  loadingText: { paddingVertical: 24, textAlign: "center", fontSize: 14, fontWeight: "800" },
  flex: { flex: 1 },
  renameInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 14, fontWeight: "800" },
  dropdownWrap: { gap: 8 },
  branchSelect: { minHeight: 58, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 12 },
  branchSelectIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  branchSelectText: { flex: 1, minWidth: 0, gap: 2 },
  dropdownLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  dropdownValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  dropdownMenu: { borderWidth: 1, borderRadius: 12, padding: 6, gap: 4 },
  dropdownOption: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  dropdownOptionText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "900", letterSpacing: 0 },
  sectionTitle: { fontSize: 15, fontWeight: "900", letterSpacing: 0, marginTop: 4 },
  historyBar: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12 },
  historyBarIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  historyBarContent: { flex: 1, minWidth: 0, gap: 2 },
  historyBarLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  historyBarBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  historyBarBadgeText: { fontSize: 11, fontWeight: "900", letterSpacing: 0 },
  historyDateBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  historyDateBtnText: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  // Purchase rate row
  prRow: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  prInfo: { flex: 1, minWidth: 0, gap: 2 },
  prStatusPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  prStatusDot: { width: 6, height: 6, borderRadius: 999 },
  prStatusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0 },
  prPanel: { alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 4, minWidth: 86 },
  prPanelLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  prPanelValue: { fontSize: 17, fontWeight: "900", letterSpacing: 0, textAlign: "center" },
  prEditBtn: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  prEditBtnText: { fontSize: 10, fontWeight: "900", letterSpacing: 0 },
});
