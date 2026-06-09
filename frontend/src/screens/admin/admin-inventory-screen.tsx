import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  fetchInventoryCategories,
  fetchInventoryItemCounts,
  fetchInventoryItemRows,
  fetchShopInventoryAllocationRows,
  fetchShops,
  updateInventoryCategory,
  updateShopInventoryAllocation,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import {
  BaseUnit,
  InventoryMovementType,
  type InventoryCategoryRead,
  type InventoryItemRead,
  type InventoryItemStockRead,
  type InventoryMovementRead,
  type ShopRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { getItemThumbnailUri } from "@/utils/item-images";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";
import type { AdminInventoryScreenProps } from "@/navigation/types";

type InventoryTab = "items" | "categories" | "shops";
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

function inventoryItemBillingNames(item: InventoryItemRead) {
  return (Array.isArray(item.billing_items) ? item.billing_items : []).map(
    (billingItem) => billingItem.billing_item_name,
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
  const [activeTab, setActiveTab] = useState<InventoryTab>("items");
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
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsLoadedShopId, setMovementsLoadedShopId] = useState<UUID | null>(null);
  const [movementHistoryOpen, setMovementHistoryOpen] = useState(false);
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
  const movementsLoadedShopIdRef = useRef<UUID | null>(null);

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );

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
    movementsLoadedShopIdRef.current = movementsLoadedShopId;
  }, [movementsLoadedShopId]);

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
        setMovementsLoadedShopId(null);
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

  const loadMovements = useCallback(async (shopId: UUID) => {
    if (movementsLoadingRef.current) {
      return;
    }
    movementsLoadingRef.current = true;
    setMovementsLoading(true);
    setErrorMessage(null);
    try {
      const nextMovements = await fetchAdminInventoryMovements({ shop_id: shopId, limit: 30 });
      setMovements(nextMovements.items);
      movementsLoadedShopIdRef.current = shopId;
      setMovementsLoadedShopId(shopId);
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
    movementsLoadedShopIdRef.current = null;
    setMovementsLoadedShopId(null);
    setStockItems([]);
    stockCursorRef.current = EMPTY_INVENTORY_CURSOR;
    stockHasMoreRef.current = false;
    stockLoadedShopIdRef.current = null;
    setStockCursor(EMPTY_INVENTORY_CURSOR);
    setStockHasMore(false);
    setStockLoadedShopId(null);
  }, [selectedShopId]);

  useEffect(() => {
    if (!movementHistoryOpen || !selectedShopId || movementsLoadedShopId === selectedShopId) {
      return;
    }
    void loadMovements(selectedShopId);
  }, [loadMovements, movementHistoryOpen, movementsLoadedShopId, selectedShopId]);

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

  const renderTabs = () => (
    <View style={[styles.tabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      {[
        { key: "items", label: "Items", icon: "package-variant-closed" },
        { key: "categories", label: "Categories", icon: "shape-outline" },
        { key: "shops", label: "Branch stock", icon: "storefront-outline" },
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
  );

  const renderItemsHeader = () => (
    <View style={styles.itemsHeader}>
      <View style={styles.row}>
        <View style={[styles.search, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search inventory"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.textPrimary }]}
          />
        </View>
        <ActionButton label="Add" icon="plus" palette={palette} active onPress={openCreateEditor} />
      </View>
    </View>
  );

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
          <IconButton icon="pencil-outline" label="Edit" palette={palette} onPress={() => openEditEditor(item)} />
          <IconButton icon="delete-outline" label="Delete" palette={palette} danger onPress={() => confirmDeleteItem(item)} />
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
        <View style={[styles.search, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="shape-plus" size={18} color={palette.textMuted} />
          <TextInput
            value={categoryDraft}
            onChangeText={setCategoryDraft}
            placeholder="New category"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.textPrimary }]}
          />
        </View>
        <ActionButton label="Save" icon="content-save-outline" palette={palette} active loading={saving} onPress={() => void saveCategory()} />
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
                  <IconButton icon="check" label="Save" palette={palette} onPress={() => void saveCategoryRename(category)} />
                  <IconButton icon="close" label="Cancel" palette={palette} onPress={() => setEditingCategoryId(null)} />
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
                  <IconButton icon="delete-outline" label="Delete" palette={palette} danger onPress={() => confirmDeleteCategory(category)} />
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
                <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Available</Text>
                <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                  {formatInventoryQuantity(item.available_quantity, item.base_unit)}
                </Text>
              </View>
              <View style={styles.itemQuantityGroup}>
                <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Used</Text>
                <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                  {formatInventoryQuantity(item.used_quantity, item.base_unit)}
                </Text>
              </View>
            </View>
          </View>
          {!item.is_active ? (
            <ActionButton
              label="Inactive"
              icon="cancel"
              palette={palette}
              disabled
              onPress={() => undefined}
            />
          ) : item.allocated ? (
            <ActionButton
              label={item.allocation_active ? "Pause" : "Activate"}
              icon={item.allocation_active ? "pause-circle-outline" : "play-circle-outline"}
              palette={palette}
              loading={busy}
              disabled={allocationDisabled}
              onPress={() => void toggleAllocation(item)}
            />
          ) : (
            <ActionButton
              label="Allocate"
              icon="link-variant-plus"
              palette={palette}
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
                    <Text style={[styles.categoryUsageLabel, { color: palette.textMuted }]}>Used</Text>
                    <Text style={[styles.categoryUsageValue, { color: palette.textPrimary }]}>
                      {formatInventoryQuantity(category.used_quantity, item.base_unit)}
                    </Text>
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
              backgroundColor: movementHistoryOpen ? "#FFFFFF" : palette.success,
              borderColor: palette.success,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={movementHistoryOpen ? "chevron-up" : "history"}
            size={20}
            color={movementHistoryOpen ? palette.success : "#FFFFFF"}
          />
          <Text style={[styles.historyButtonText, { color: movementHistoryOpen ? palette.success : "#FFFFFF" }]}>
            {movementHistoryOpen ? "Hide history" : "History"}
          </Text>
        </Pressable>
      </View>
      {movementHistoryOpen ? (
        <>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Recent movement</Text>
          {movementsLoading ? (
            <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <ActivityIndicator color={palette.inventory} />
              <Text style={[styles.itemMeta, { color: palette.textMuted }]}>Loading movement history...</Text>
            </View>
          ) : movements.length === 0 ? (
            <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <MaterialCommunityIcons name="history" size={20} color={palette.textMuted} />
              <Text style={[styles.itemMeta, { color: palette.textMuted }]}>No recent stock movement yet.</Text>
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
                  <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
                    {movement.movement_type === InventoryMovementType.ADD ? "Added" : `Used for ${movement.category_name ?? "category"}`} · {formatInventoryQuantity(movement.quantity, movement.unit)}
                  </Text>
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
          <Text style={[styles.subtitle, { color: palette.onShellMuted }]}>Items, categories, and branch stock</Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing}
          onRefresh={() => loadBaseData(true)}
        />
      </View>
      {activeTab === "items" ? (
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
          ListHeaderComponent={(
            <View style={styles.section}>
              {renderTabs()}
              {errorMessage ? (
                <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
                  <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
                </View>
              ) : null}
              {renderItemsHeader()}
              {itemsLoading && items.length === 0 ? (
                <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading inventory...</Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            !itemsLoading ? (
              <Text style={[styles.loadingText, { color: palette.textMuted }]}>No inventory items found.</Text>
            ) : null
          }
          ListFooterComponent={renderItemsFooter}
          onEndReached={() => void loadInventoryRows({ append: true })}
          onEndReachedThreshold={0.35}
        />
      ) : activeTab === "shops" ? (
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
          ListHeaderComponent={(
            <View style={styles.section}>
              {renderTabs()}
              {errorMessage ? (
                <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
                  <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
                </View>
              ) : null}
              {renderShopStockHeader()}
            </View>
          )}
          ListEmptyComponent={
            !stockLoading ? (
              <Text style={[styles.loadingText, { color: palette.textMuted }]}>No branch stock rows found.</Text>
            ) : null
          }
          ListFooterComponent={renderShopStockFooter}
          onEndReached={() => void loadMoreShopData()}
          onEndReachedThreshold={0.35}
        />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
          }
          contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
        >
          {renderTabs()}
          {errorMessage ? (
            <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
            </View>
          ) : null}
          {loading ? (
            <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading inventory...</Text>
          ) : (
            renderCategories()
          )}
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  active = false,
  danger = false,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = disabled ? palette.textMuted : danger ? palette.danger : active ? palette.onPrimary : palette.textPrimary;
  const bg = disabled ? palette.surfaceMuted : danger ? palette.dangerSoft : active ? palette.inventory : palette.card;
  const border = disabled ? palette.border : danger ? palette.danger : active ? palette.inventory : palette.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.actionButton, { borderColor: border, backgroundColor: bg, opacity: loading ? 0.65 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={fg} />
      <Text numberOfLines={1} style={[styles.actionText, { color: fg }]}>{loading ? "..." : label}</Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  palette,
  danger = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  palette: ThemePalette;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <MaterialCommunityIcons name={icon} size={19} color={danger ? palette.danger : palette.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  content: { padding: 16, gap: 14 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 42, borderRadius: 9, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  tabText: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  section: { gap: 10 },
  itemsHeader: { gap: 10 },
  listSeparator: { height: 10 },
  listFooter: { minHeight: 56, alignItems: "center", justifyContent: "center" },
  listFooterSpacer: { height: 10 },
  itemCountText: { paddingVertical: 14, textAlign: "center", fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyToggleRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  historyButton: {
    width: "100%",
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  historyButtonText: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  search: { minHeight: 46, flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 42, fontSize: 14, fontWeight: "700" },
  itemRow: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stockItemCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  stockItemHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  categoryUsageList: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 7 },
  categoryUsageRow: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  categoryUsageName: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  categoryUsageTotals: { alignItems: "flex-end", gap: 5 },
  categoryUsageTotal: { alignItems: "flex-end", gap: 1 },
  categoryUsageLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  categoryUsageValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  movementRow: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  itemSub: { fontSize: 13, fontWeight: "700", letterSpacing: 0 },
  itemMeta: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  mappingSummary: { marginTop: 8, gap: 6 },
  mappingHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  mappingLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  mappingEmpty: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  mappingChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mappingChip: { maxWidth: "100%", minHeight: 28, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  mappingChipText: { flexShrink: 1, fontSize: 12, fontWeight: "900", letterSpacing: 0, lineHeight: 16 },
  itemQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 3 },
  itemQuantityGroup: { gap: 1 },
  quantityLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  quantityValue: { fontSize: 16, fontWeight: "900", letterSpacing: 0 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconButton: { minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center" },
  actionButton: { minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  actionText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontWeight: "700" },
  loadingText: { paddingVertical: 24, textAlign: "center", fontSize: 14, fontWeight: "800" },
  flex: { flex: 1 },
  renameInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, fontWeight: "800" },
  dropdownWrap: { gap: 8 },
  branchSelect: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  branchSelectIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  branchSelectText: { flex: 1, minWidth: 0, gap: 2 },
  dropdownLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  dropdownValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  dropdownMenu: { borderWidth: 1, borderRadius: 14, padding: 6, gap: 4 },
  dropdownOption: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  dropdownOptionText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "900", letterSpacing: 0 },
  sectionTitle: { fontSize: 15, fontWeight: "900", letterSpacing: 0, marginTop: 4 },
});
