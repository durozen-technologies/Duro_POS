import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack } from "tamagui";

import {
  fetchItemCategories,
  fetchShopPriceHistory,
  updateItemAssumption,
  type FetchShopItemsParams,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import { useApiConnection } from "@/hooks/use-api-connection";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAdminItemsStore } from "@/store/admin-items-store";
import type {
  DailyPriceCreate,
  ItemAssumptionUpdate,
  ItemCategoryRead,
  ItemPriceRead,
  ShopBootstrapResponse,
  ShopItemRead,
  UUID,
} from "@/types/api";
import { isPositiveNumber, toMoneyString } from "@/utils/decimal";
import { prefetchItemThumbnails } from "@/utils/item-images";
import type {
  AdminItemPricesScreenProps,
  AdminItemAssumptionScreenProps,
  AdminItemsCatalogueScreenProps,
  AdminShopItemsScreenProps,
} from "@/navigation/types";

import { useAdminTheme } from "./use-admin-theme";
import {
  AdminItemEditorMode,
  AdminItemFormScope,
  AdminItemWorkspace,
  ItemScope,
} from "./admin-items-model";
import {
  EmptyState,
  ErrorState,
  AssumptionGrid,
  FilterBar,
  ImportCatalogueToolbar,
  ItemList,
  ItemRow,
  PriceGrid,
  type RowAction,
  ShopPicker,
  ShopItemsCategoryToolbar,
  ShopItemsInlineTabs,
  type CategoryFilterOption,
  type ShopItemsTab,
  StatsStrip,
  WorkspaceTabs,
  type AssumptionDraft,
} from "./components/admin-items-management";
import { ToastBanner } from "./components/admin-dashboard-primitives";
import { AdminHeaderActions } from "./components/admin-header-actions";
import {
  useAdminItemShops,
  useAvailableCatalogueItems,
  useCatalogueItems,
  useSelectedShopItems,
  useShopPrices,
} from "./hooks/use-admin-items-data";
import { triggerHaptic, type ToastTone } from "./admin-dashboard-utils";

type ItemsRouteProps =
  | AdminItemsCatalogueScreenProps
  | AdminItemAssumptionScreenProps
  | AdminShopItemsScreenProps
  | AdminItemPricesScreenProps;

const ALL_CATEGORY_FILTER_KEY = "all";
const UNCATEGORIZED_CATEGORY_FILTER_KEY = "uncategorized";

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSelectedShopItemQuery(search: string, categoryKey: string): FetchShopItemsParams {
  const query: FetchShopItemsParams = {
    q: search.trim() || undefined,
    limit: 50,
  };

  if (categoryKey === UNCATEGORIZED_CATEGORY_FILTER_KEY) {
    query.uncategorized = true;
  } else if (categoryKey !== ALL_CATEGORY_FILTER_KEY) {
    query.category_id = categoryKey;
  }

  return query;
}

function buildCatalogueItemQuery(search: string): FetchShopItemsParams {
  return {
    q: search.trim() || undefined,
    limit: 50,
  };
}

function isAdminCatalogueItem(item: ShopItemRead) {
  return item.scope === ItemScope.Global && !item.shop_id;
}

function AdminItemsRoute({
  navigation,
  route,
  workspace,
}: ItemsRouteProps & { workspace: AdminItemWorkspace }) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const storedShopId = useAdminItemsStore((state) => state.selectedShopId);
  const adminItemsHydrated = useAdminItemsStore((state) => state.hydrated);
  const setStoredShopId = useAdminItemsStore((state) => state.setSelectedShopId);
  const routeShopId = "params" in route ? route.params?.shopId : undefined;
  const initialShopId = routeShopId ?? storedShopId;
  const appliedRouteShopIdRef = useRef<UUID | undefined>(routeShopId);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(initialShopId ?? null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [importSearch, setImportSearch] = useState("");
  const debouncedImportSearch = useDebouncedValue(importSearch.trim(), 300);
  const [shopItemsTab, setShopItemsTab] = useState<ShopItemsTab>("selected");
  const [selectedImportIds, setSelectedImportIds] = useState<Set<UUID>>(() => new Set());
  const [itemCategories, setItemCategories] = useState<ItemCategoryRead[]>([]);
  const [itemCategoriesLoading, setItemCategoriesLoading] = useState(false);
  const [assumptionDrafts, setAssumptionDrafts] = useState<Record<UUID, AssumptionDraft>>({});
  const [savingAssumptionId, setSavingAssumptionId] = useState<UUID | null>(null);
  const [categoryFilterKey, setCategoryFilterKey] = useState(ALL_CATEGORY_FILTER_KEY);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const toastAnimation = useMemo(() => new Animated.Value(0), []);
  const isCatalogueWorkspace = workspace === AdminItemWorkspace.Catalogue;
  const isAssumptionWorkspace = workspace === AdminItemWorkspace.Assumption;
  const isShopItemsWorkspace = workspace === AdminItemWorkspace.Shop;
  const isPricesWorkspace = workspace === AdminItemWorkspace.Prices;
  const isCatalogueLikeWorkspace = isCatalogueWorkspace || isAssumptionWorkspace;
  const workspaceNeedsShop = isShopItemsWorkspace || isPricesWorkspace;
  const shopsState = useAdminItemShops(isFocused && workspaceNeedsShop);
  const catalogueState = useCatalogueItems(isFocused && isCatalogueLikeWorkspace);
  const shopItemsState = useSelectedShopItems(selectedShopId, isFocused && isShopItemsWorkspace);
  const availableCatalogueState = useAvailableCatalogueItems(
    selectedShopId,
    isFocused && isShopItemsWorkspace && shopItemsTab === "available",
  );
  const priceState = useShopPrices(selectedShopId, isFocused && isPricesWorkspace);
  const [priceHistoryOpen, setPriceHistoryOpen] = useState(false);
  const [priceHistoryDate, setPriceHistoryDate] = useState(() => toDateInputValue());
  const [priceHistoryMonth, setPriceHistoryMonth] = useState(() => toDateInputValue());
  const [priceHistoryBootstrap, setPriceHistoryBootstrap] = useState<ShopBootstrapResponse | null>(null);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const apiConnection = useApiConnection();

  const selectedShop = useMemo(
    () => shopsState.shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shopsState.shops],
  );
  const selectedImportCount = selectedImportIds.size;
  const selectedImportKey = useMemo(
    () => [...selectedImportIds].sort().join("|"),
    [selectedImportIds],
  );
  const assumptionItems = useMemo(
    () => catalogueState.items.filter(isAdminCatalogueItem),
    [catalogueState.items],
  );
  const importingImportKey = useMemo(
    () => [...availableCatalogueState.importingIds].sort().join("|"),
    [availableCatalogueState.importingIds],
  );
  const categoryFilterOptions = useMemo<CategoryFilterOption[]>(
    () => [
      { key: ALL_CATEGORY_FILTER_KEY, label: "All categories" },
      ...itemCategories.map((category) => ({ key: category.id, label: category.name })),
      { key: UNCATEGORIZED_CATEGORY_FILTER_KEY, label: "Uncategorized" },
    ],
    [itemCategories],
  );
  const selectedShopItemQuery = useMemo(
    () => buildSelectedShopItemQuery(debouncedSearch, categoryFilterKey),
    [categoryFilterKey, debouncedSearch],
  );
  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
  }, []);

  const loadPriceHistory = useCallback(async (dateValue = priceHistoryDate) => {
    if (!selectedShopId) {
      setPriceHistoryBootstrap(null);
      return;
    }
    setPriceHistoryLoading(true);
    setPriceHistoryError(null);
    setPriceHistoryBootstrap(null);
    try {
      const nextBootstrap = await fetchShopPriceHistory(selectedShopId, dateValue);
      setPriceHistoryBootstrap(nextBootstrap);
    } catch (error) {
      const message = toApiError(error).message || "Unable to load price history.";
      setPriceHistoryError(message);
      showToast("error", message);
    } finally {
      setPriceHistoryLoading(false);
    }
  }, [priceHistoryDate, selectedShopId, showToast]);

  useEffect(() => {
    if (!toast) {
      toastAnimation.setValue(0);
      return;
    }
    Animated.timing(toastAnimation, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast, toastAnimation]);

  useEffect(() => {
    if (!isFocused || !isShopItemsWorkspace) {
      return;
    }
    const controller = new AbortController();
    setItemCategoriesLoading(true);
    void fetchItemCategories({ signal: controller.signal })
      .then((nextCategories) => {
        setItemCategories(nextCategories);
      })
      .catch((error) => {
        if (!isApiRequestCanceled(error)) {
          showToast("error", toApiError(error).message || "Unable to load categories.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setItemCategoriesLoading(false);
        }
      });
    return () => controller.abort();
  }, [isFocused, isShopItemsWorkspace, showToast]);

  useEffect(() => {
    if (categoryFilterOptions.some((option) => option.key === categoryFilterKey)) {
      return;
    }
    setCategoryFilterKey(ALL_CATEGORY_FILTER_KEY);
  }, [categoryFilterKey, categoryFilterOptions]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    if (routeShopId === appliedRouteShopIdRef.current) {
      return;
    }
    appliedRouteShopIdRef.current = routeShopId;
    if (routeShopId) {
      setSelectedShopId(routeShopId);
      setStoredShopId(routeShopId);
    }
  }, [isFocused, routeShopId, setStoredShopId]);

  useEffect(() => {
    if (!isFocused || routeShopId || !adminItemsHydrated || !storedShopId || selectedShopId === storedShopId) {
      return;
    }
    setSelectedShopId(storedShopId);
  }, [adminItemsHydrated, isFocused, routeShopId, selectedShopId, storedShopId]);

  useEffect(() => {
    if (!isFocused || !adminItemsHydrated) {
      return;
    }
    if (selectedShopId) {
      setStoredShopId(selectedShopId);
      return;
    }
    if (workspaceNeedsShop && shopsState.shops[0]?.id) {
      setSelectedShopId(shopsState.shops[0].id);
    }
  }, [adminItemsHydrated, isFocused, selectedShopId, setStoredShopId, shopsState.shops, workspaceNeedsShop]);

  useEffect(() => {
    setShopItemsTab("selected");
    setImportSearch("");
    setSelectedImportIds(new Set());
    setAssumptionDrafts({});
  }, [workspace]);

  useEffect(() => {
    if (isFocused && isCatalogueLikeWorkspace) {
      void catalogueState.load(buildCatalogueItemQuery(debouncedSearch)).catch((error) => {
        showToast("error", error instanceof Error ? error.message : "Unable to load catalogue.");
      });
    }
  }, [catalogueState.load, debouncedSearch, isCatalogueLikeWorkspace, isFocused, showToast]);

  useEffect(() => {
    if (isFocused && isCatalogueLikeWorkspace) {
      prefetchItemThumbnails(isAssumptionWorkspace ? assumptionItems : catalogueState.items);
    }
  }, [assumptionItems, catalogueState.items, isAssumptionWorkspace, isCatalogueLikeWorkspace, isFocused]);

  useEffect(() => {
    if (!isFocused || workspace !== AdminItemWorkspace.Shop || !selectedShopId) {
      return;
    }
    void shopItemsState.load(selectedShopItemQuery).catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to load shop items.");
    });
  }, [isFocused, selectedShopId, selectedShopItemQuery, shopItemsState.load, showToast, workspace]);

  useEffect(() => {
    if (!isFocused || workspace !== AdminItemWorkspace.Shop || !selectedShopId || shopItemsTab !== "available") {
      return;
    }
    void availableCatalogueState.load({
      q: debouncedImportSearch || undefined,
      limit: 50,
    }).catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to load catalogue items.");
    });
  }, [
    availableCatalogueState.load,
    debouncedImportSearch,
    isFocused,
    selectedShopId,
    shopItemsTab,
    showToast,
    workspace,
  ]);

  useEffect(() => {
    if (isFocused && workspace === AdminItemWorkspace.Shop && shopItemsTab === "selected") {
      prefetchItemThumbnails(shopItemsState.items);
    }
  }, [isFocused, shopItemsState.items, shopItemsTab, workspace]);

  useEffect(() => {
    if (isFocused && workspace === AdminItemWorkspace.Shop && shopItemsTab === "available") {
      prefetchItemThumbnails(availableCatalogueState.items);
    }
  }, [availableCatalogueState.items, isFocused, shopItemsTab, workspace]);

  useEffect(() => {
    if (isFocused && workspace === AdminItemWorkspace.Prices) {
      prefetchItemThumbnails(priceState.bootstrap?.items ?? []);
    }
  }, [isFocused, priceState.bootstrap?.items, workspace]);

  useEffect(() => {
    if (isFocused && workspace === AdminItemWorkspace.Prices && priceHistoryOpen) {
      prefetchItemThumbnails(priceHistoryBootstrap?.items ?? []);
    }
  }, [isFocused, priceHistoryBootstrap?.items, priceHistoryOpen, workspace]);

  useEffect(() => {
    setSelectedImportIds(new Set());
    setImportSearch("");
    setShopItemsTab("selected");
    setCategoryFilterKey(ALL_CATEGORY_FILTER_KEY);
    setPriceHistoryOpen(false);
    setPriceHistoryBootstrap(null);
    setPriceHistoryError(null);
  }, [selectedShopId]);

  const selectShop = useCallback((shopId: UUID) => {
    setStoredShopId(shopId);
    setSelectedShopId(shopId);
    setShopItemsTab("selected");
    setImportSearch("");
    setSelectedImportIds(new Set());
  }, [setStoredShopId]);

  const navigateCreate = useCallback((scope: AdminItemFormScope) => {
    navigation.navigate("AdminItemEditor", {
      mode: AdminItemEditorMode.Create,
      workspace: scope === AdminItemFormScope.Catalogue ? AdminItemWorkspace.Catalogue : AdminItemWorkspace.Shop,
      shopId: selectedShopId ?? undefined,
    });
  }, [navigation, selectedShopId]);

  const navigateEdit = useCallback((item: ShopItemRead, forceCatalogue = false) => {
    const editingCatalogue = forceCatalogue || workspace === AdminItemWorkspace.Catalogue;
    navigation.navigate("AdminItemEditor", {
      mode:
        item.scope === ItemScope.Global && !editingCatalogue
          ? AdminItemEditorMode.Customize
          : AdminItemEditorMode.Edit,
      workspace: editingCatalogue ? AdminItemWorkspace.Catalogue : AdminItemWorkspace.Shop,
      itemId: item.id,
      shopId: selectedShopId ?? undefined,
      initialItem: item,
    });
  }, [navigation, selectedShopId, workspace]);

  const navigatePrices = useCallback(() => {
    navigation.navigate("AdminItemPrices", { shopId: selectedShopId ?? undefined });
  }, [navigation, selectedShopId]);

  const navigateArrangeOrder = useCallback(() => {
    if (!selectedShopId) {
      triggerHaptic();
      showToast("error", "Select a shop before arranging items.");
      return;
    }
    navigation.navigate("AdminShopItemsOrder", {
      shopId: selectedShopId,
      shopName: selectedShop?.name,
    });
  }, [navigation, selectedShop?.name, selectedShopId, showToast]);

  const confirmDelete = useCallback((item: ShopItemRead) => {
    if (workspace !== AdminItemWorkspace.Catalogue && item.scope === ItemScope.Global) {
      showToast("error", "Remove catalogue items from the shop instead of deleting the global record.");
      return;
    }
    Alert.alert(
      item.scope === ItemScope.Global ? "Delete catalogue item" : "Delete shop item",
      item.scope === ItemScope.Global
        ? `Delete ${item.name} from the catalogue? This is only allowed when it has no billing or price history.`
        : `Delete ${item.name}? Items with billing or price history cannot be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (workspace === AdminItemWorkspace.Catalogue) {
                  await catalogueState.deleteItem(item.id);
                } else {
                  await shopItemsState.deleteItem(item);
                }
                showToast("success", `${item.name} deleted.`);
              } catch (error) {
                showToast("error", error instanceof Error ? error.message : "Unable to delete item.");
              }
            })();
          },
        },
      ],
    );
  }, [catalogueState, shopItemsState, showToast, workspace]);

  const openAvailableCatalogue = useCallback(() => {
    setShopItemsTab("available");
  }, []);

  const showSelectedItems = useCallback(() => {
    setShopItemsTab("selected");
    setImportSearch("");
    setSelectedImportIds(new Set());
  }, []);

  const toggleImportSelection = useCallback((itemId: UUID) => {
    setSelectedImportIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const changeImportSearch = useCallback((value: string) => {
    setImportSearch(value);
    setSelectedImportIds(new Set());
  }, []);

  const importCatalogueItemIds = useCallback((itemIds: UUID[]) => {
    if (!selectedShopId) {
      triggerHaptic();
      showToast("error", "Select a shop before importing items.");
      return;
    }
    if (itemIds.length === 0) {
      triggerHaptic();
      showToast("error", "Select at least one catalogue item.");
      return;
    }

    void availableCatalogueState.importItems(itemIds)
      .then((result) => {
        setSelectedImportIds((current) => {
          const next = new Set(current);
          result.item_ids.forEach((itemId) => next.delete(itemId));
          return next;
        });
        void shopItemsState.refresh().catch(() => undefined);
        const importedTotal = result.allocated_count + result.already_allocated_count;
        const shopSuffix = selectedShop?.name ? ` to ${selectedShop.name}` : "";
        showToast(
          "success",
          `${importedTotal} item${importedTotal === 1 ? "" : "s"} imported${shopSuffix}.`,
        );
      })
      .catch((error) => showToast("error", error instanceof Error ? error.message : "Unable to import items."));
  }, [availableCatalogueState, selectedShop?.name, selectedShopId, shopItemsState, showToast]);

  const importCatalogueItem = useCallback((item: ShopItemRead) => {
    importCatalogueItemIds([item.id]);
  }, [importCatalogueItemIds]);

  const importSelectedCatalogueItems = useCallback(() => {
    importCatalogueItemIds([...selectedImportIds]);
  }, [importCatalogueItemIds, selectedImportIds]);

  const itemActions = useCallback((item: ShopItemRead): { primary: RowAction; secondary: RowAction[] } => {
    const isCatalogueWorkspace = workspace === AdminItemWorkspace.Catalogue;
    const isGlobal = item.scope === ItemScope.Global;
    const primary: RowAction = isCatalogueWorkspace
      ? {
        label: "Edit",
        icon: "pencil-outline",
        onPress: () => navigateEdit(item),
      }
      : isGlobal
        ? {
          label: "Remove",
          icon: "link-variant-off",
          tone: "danger",
          disabled: !item.can_deallocate,
          onPress: () => {
            void shopItemsState.deallocate(item.id)
              .then(() => showToast("success", `${item.name} removed from shop.`))
              .catch((error) => showToast("error", error instanceof Error ? error.message : "Unable to remove item."));
          },
        }
        : {
          label: "Edit",
          icon: "pencil-outline",
          onPress: () => navigateEdit(item),
        };

    const secondary: RowAction[] = [];

    return { primary, secondary };
  }, [navigateEdit, shopItemsState, showToast, workspace]);

  const refreshCatalogue = useCallback(() => {
    void catalogueState.refresh().catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to refresh catalogue.");
    });
  }, [catalogueState, showToast]);

  const refreshShopItems = useCallback(() => {
    void shopItemsState.refresh().catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to refresh shop items.");
    });
  }, [shopItemsState, showToast]);

  const refreshPrices = useCallback(() => {
    void priceState.load(true).catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to refresh prices.");
    });
  }, [priceState, showToast]);

  const refreshImportItems = useCallback(() => {
    void availableCatalogueState.refresh().catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to refresh catalogue items.");
    });
  }, [availableCatalogueState, showToast]);

  const refreshCurrentItemsPage = useCallback(() => {
    if (workspaceNeedsShop) {
      void shopsState.reload().catch(() => undefined);
    }
    if (workspace === AdminItemWorkspace.Catalogue) {
      refreshCatalogue();
      return;
    }
    if (workspace === AdminItemWorkspace.Assumption) {
      refreshCatalogue();
      return;
    }
    if (workspace === AdminItemWorkspace.Prices) {
      if (priceHistoryOpen) {
        void loadPriceHistory(priceHistoryDate);
        return;
      }
      refreshPrices();
      return;
    }
    if (shopItemsTab === "available") {
      refreshImportItems();
      return;
    }
    refreshShopItems();
  }, [
    refreshCatalogue,
    refreshImportItems,
    refreshPrices,
    refreshShopItems,
    shopItemsTab,
    shopsState,
    workspace,
    workspaceNeedsShop,
    loadPriceHistory,
    priceHistoryDate,
    priceHistoryOpen,
    showToast,
  ]);

  const headerRefreshing =
    workspace === AdminItemWorkspace.Catalogue
      ? catalogueState.refreshing
      : workspace === AdminItemWorkspace.Assumption
        ? catalogueState.refreshing
        : workspace === AdminItemWorkspace.Prices
          ? priceState.refreshing || priceHistoryLoading || shopsState.loading
          : shopItemsTab === "available"
            ? availableCatalogueState.refreshing || shopsState.loading
            : shopItemsState.refreshing || shopsState.loading;

  const changeAssumptionDraft = useCallback((item: ShopItemRead, patch: AssumptionDraft) => {
    setAssumptionDrafts((current) => {
      const previous = current[item.id] ?? {
        assumption_percent: item.assumption_percent ?? "",
      };
      return {
        ...current,
        [item.id]: {
          ...previous,
          ...patch,
        },
      };
    });
  }, []);

  const saveAssumptionRow = useCallback((item: ShopItemRead, payload: ItemAssumptionUpdate) => {
    setSavingAssumptionId(item.id);
    void updateItemAssumption(item.id, payload)
      .then(() => {
        setAssumptionDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        showToast("success", `${item.name} assumption saved.`);
        void catalogueState.refresh().catch(() => undefined);
      })
      .catch((error) => {
        showToast("error", error instanceof Error ? error.message : "Unable to save assumption.");
      })
      .finally(() => {
        setSavingAssumptionId(null);
      });
  }, [catalogueState, showToast]);

  const clearAssumptionRow = useCallback((item: ShopItemRead) => {
    setSavingAssumptionId(item.id);
    void updateItemAssumption(item.id, {
      assumption_percent: null,
      assumption_inventory_item_id: null,
      assumption_inventory_category_id: null,
    })
      .then(() => {
        setAssumptionDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        showToast("success", `${item.name} assumption cleared.`);
        void catalogueState.refresh().catch(() => undefined);
      })
      .catch((error) => {
        showToast("error", error instanceof Error ? error.message : "Unable to clear assumption.");
      })
      .finally(() => {
        setSavingAssumptionId(null);
      });
  }, [catalogueState, showToast]);

  const savePriceRow = useCallback((item: ItemPriceRead, rawValue: string) => {
    if (!isPositiveNumber(rawValue)) {
      triggerHaptic();
      showToast("error", "Enter a price greater than 0.");
      return;
    }
    void priceState.saveRow(item.item_id, toMoneyString(rawValue))
      .then(() => {
        showToast("success", `${item.item_name} price saved.`);
        void shopItemsState.refresh().catch(() => undefined);
      })
      .catch((error) => showToast("error", error instanceof Error ? error.message : "Unable to save price."));
  }, [priceState, shopItemsState, showToast]);

  const saveEditedPrices = useCallback((entries: DailyPriceCreate["entries"]) => {
    if (entries.length === 0) {
      showToast("error", "Edit at least one price before saving.");
      return;
    }
    if (entries.some((entry) => !isPositiveNumber(entry.price_per_unit))) {
      triggerHaptic();
      showToast("error", "Fix invalid edited prices before saving.");
      return;
    }
    void priceState.saveRows(entries)
      .then(() => {
        showToast("success", `${entries.length} price${entries.length === 1 ? "" : "s"} saved.`);
        void shopItemsState.refresh().catch(() => undefined);
      })
      .catch((error) => showToast("error", error instanceof Error ? error.message : "Unable to save edited prices."));
  }, [priceState, shopItemsState, showToast]);

  const completeTodayPrices = useCallback((entries: DailyPriceCreate["entries"], _staleCarryCount: number) => {
    if (entries.length === 0) {
      triggerHaptic();
      showToast("error", "Add today's prices for every item before saving.");
      return;
    }
    if (entries.some((entry) => !isPositiveNumber(entry.price_per_unit))) {
      triggerHaptic();
      showToast("error", "Add prices greater than 0 before completing today.");
      return;
    }
    void priceState.saveAll(entries)
      .then(() => {
        showToast("success", "Today's prices published for shop billing.");
        void shopItemsState.refresh().catch(() => undefined);
      })
      .catch((error) => showToast("error", error instanceof Error ? error.message : "Unable to save prices."));
  }, [priceState, shopItemsState, showToast]);

  const togglePriceHistory = useCallback(() => {
    if (priceHistoryOpen) {
      setPriceHistoryOpen(false);
      return;
    }
    setPriceHistoryOpen(true);
    void loadPriceHistory(priceHistoryDate);
  }, [loadPriceHistory, priceHistoryDate, priceHistoryOpen]);

  const selectPriceHistoryDate = useCallback((dateValue: string) => {
    setPriceHistoryDate(dateValue);
    setPriceHistoryMonth(dateValue);
    void loadPriceHistory(dateValue);
  }, [loadPriceHistory]);

  const refreshPriceHistory = useCallback(() => {
    void loadPriceHistory(priceHistoryDate);
  }, [loadPriceHistory, priceHistoryDate]);

  const commonHeader = (
    <YStack gap={10}>
      <ErrorState
        message={
          apiConnection.status === "offline"
            ? `Backend offline at ${apiConnection.baseUrl || "configured API URL"}. ${apiConnection.message}`
            : null
        }
        palette={palette}
        onRetry={() => void apiConnection.retry()}
      />
      {workspaceNeedsShop ? (
        <ErrorState message={shopsState.error} palette={palette} onRetry={() => void shopsState.reload().catch(() => undefined)} />
      ) : null}
      <WorkspaceTabs
        workspace={workspace}
        palette={palette}
        onCatalogue={() => navigation.navigate("AdminItemsCatalogue")}
        onAssumption={() => navigation.navigate("AdminItemAssumption")}
        onShopItems={() => navigation.navigate("AdminShopItems", { shopId: selectedShopId ?? undefined })}
        onPrices={navigatePrices}
      />
      {workspaceNeedsShop ? (
        <ShopPicker
          shops={shopsState.shops}
          selectedShop={selectedShop}
          loading={shopsState.loading}
          palette={palette}
          onSelectShop={selectShop}
        />
      ) : null}
    </YStack>
  );

  const renderCatalogue = () => (
    <ItemList
      items={catalogueState.items}
      loading={catalogueState.loading}
      refreshing={catalogueState.refreshing}
      loadingMore={catalogueState.loadingMore}
      hasMore={catalogueState.hasMore}
      palette={palette}
      bottomPadding={48 + insets.bottom}
      onRefresh={refreshCatalogue}
      onLoadMore={() => {
        void catalogueState.loadMore().catch((error) => {
          showToast("error", error instanceof Error ? error.message : "Unable to load more items.");
        });
      }}
      emptyTitle={search.trim() ? "No catalogue matches" : "No catalogue items yet"}
      emptyMessage={
        search.trim()
          ? "Clear search to see more catalogue items."
          : "Create the first global catalogue item to reuse across shops."
      }
      emptyAction={{
        label: "Add catalogue item",
        icon: "plus-circle-outline",
        onPress: () => navigateCreate(AdminItemFormScope.Catalogue),
      }}
      header={
        <YStack gap={12}>
          {commonHeader}
          <ErrorState message={catalogueState.error} palette={palette} onRetry={refreshCatalogue} />
          <FilterBar
            workspace={AdminItemWorkspace.Catalogue}
            search={search}
            palette={palette}
            onChangeSearch={setSearch}
            onCreate={() => navigateCreate(AdminItemFormScope.Catalogue)}
          />
          <StatsStrip counts={catalogueState.counts} totalCount={catalogueState.totalCount} palette={palette} />
        </YStack>
      }
      renderItem={(item) => {
        const actions = itemActions(item);
        return (
          <ItemRow
            item={item}
            palette={palette}
            primaryAction={actions.primary}
            secondaryActions={actions.secondary}
            thumbnailSize={60}
            actionsPlacement="side"
          />
        );
      }}
    />
  );

  const renderAssumption = () => (
    <>
      <View style={[styles.fixedHeader, { backgroundColor: palette.background }]}>
        {commonHeader}
      </View>
      <AssumptionGrid
        items={assumptionItems}
        loading={catalogueState.loading}
        refreshing={catalogueState.refreshing}
        drafts={assumptionDrafts}
        savingItemId={savingAssumptionId}
        error={catalogueState.error}
        palette={palette}
        bottomPadding={48 + insets.bottom}
        onRefresh={refreshCurrentItemsPage}
        onChangeDraft={changeAssumptionDraft}
        onSaveRow={saveAssumptionRow}
        onClearRow={clearAssumptionRow}
      />
    </>
  );

  const renderShopItems = () => {
    if (!selectedShop) {
      return (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + insets.bottom }]}
          style={{ backgroundColor: palette.background }}
        >
          {commonHeader}
          <EmptyState
            title="Select a shop"
            message="Choose a shop before selecting catalogue items."
            icon="store-alert-outline"
            palette={palette}
          />
        </ScrollView>
      );
    }
    if (shopItemsTab === "available") {
      return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
          <View style={[styles.fixedHeader, { backgroundColor: palette.background }]}>
            <YStack gap={10}>
              {commonHeader}
              <ErrorState message={availableCatalogueState.error} palette={palette} onRetry={refreshImportItems} />
              <ShopItemsInlineTabs
                activeTab={shopItemsTab}
                selectedCount={shopItemsState.totalCount}
                availableCount={availableCatalogueState.totalCount}
                palette={palette}
                onChangeTab={setShopItemsTab}
              />
              <ImportCatalogueToolbar
                search={importSearch}
                selectedCount={selectedImportCount}
                importing={availableCatalogueState.importing}
                palette={palette}
                onChangeSearch={changeImportSearch}
                onImportSelected={importSelectedCatalogueItems}
                onClearSelection={() => setSelectedImportIds(new Set())}
                onDone={showSelectedItems}
              />
            </YStack>
          </View>
          <ItemList
            items={availableCatalogueState.items}
            loading={availableCatalogueState.loading}
            refreshing={availableCatalogueState.refreshing}
            loadingMore={availableCatalogueState.loadingMore}
            hasMore={availableCatalogueState.hasMore}
            palette={palette}
            bottomPadding={48 + insets.bottom}
            extraData={`${selectedImportKey}:${importingImportKey}`}
            onRefresh={refreshImportItems}
            onLoadMore={() => {
              void availableCatalogueState.loadMore().catch((error) => {
                showToast("error", error instanceof Error ? error.message : "Unable to load more catalogue items.");
              });
            }}
            emptyTitle={importSearch.trim() ? "No available matches" : "No catalogue items available"}
            emptyMessage={
              importSearch.trim()
                ? "Clear search to see more available catalogue items."
                : "All active global catalogue items are already selected for this shop."
            }
            emptyAction={{
              label: "Done",
              icon: "check",
              onPress: showSelectedItems,
            }}
            header={<StatsStrip counts={availableCatalogueState.counts} totalCount={availableCatalogueState.totalCount} palette={palette} />}
            renderItem={(item) => {
              const selected = selectedImportIds.has(item.id);
              const importing = availableCatalogueState.importingIds.has(item.id);
              return (
                <ItemRow
                  item={item}
                  palette={palette}
                  primaryAction={{
                    label: "Import",
                    icon: "tray-arrow-down",
                    disabled: importing,
                    loading: importing,
                    onPress: () => importCatalogueItem(item),
                  }}
                  secondaryActions={[
                    {
                      label: selected ? "Selected" : "Select",
                      icon: selected ? "checkbox-marked-outline" : "checkbox-blank-outline",
                      tone: selected ? "primary" : "neutral",
                      disabled: importing,
                      onPress: () => toggleImportSelection(item.id),
                    },
                  ]}
                  thumbnailSize={60}
                />
              );
            }}
          />
        </View>
      );
    }
    return (
      <ItemList
        items={shopItemsState.items}
        loading={shopItemsState.loading}
        refreshing={shopItemsState.refreshing}
        loadingMore={shopItemsState.loadingMore}
        hasMore={shopItemsState.hasMore}
        palette={palette}
        bottomPadding={48 + insets.bottom}
        onRefresh={refreshShopItems}
        onLoadMore={() => {
          void shopItemsState.loadMore().catch((error) => {
            showToast("error", error instanceof Error ? error.message : "Unable to load more items.");
          });
        }}
        emptyTitle={search.trim() ? "No selected items match" : "No items selected"}
        emptyMessage={
          search.trim()
            ? "Clear search or import more catalogue items."
            : "Import catalogue items to make them available for this shop."
        }
        emptyAction={{
          label: "Import catalogue",
          icon: "tray-arrow-down",
          onPress: openAvailableCatalogue,
        }}
        header={
          <YStack gap={12}>
            {commonHeader}
            <ErrorState message={shopItemsState.error} palette={palette} onRetry={refreshShopItems} />
            <ShopItemsInlineTabs
              activeTab={shopItemsTab}
              selectedCount={shopItemsState.totalCount}
              availableCount={null}
              palette={palette}
              onChangeTab={setShopItemsTab}
            />
            <ShopItemsCategoryToolbar
              options={categoryFilterOptions}
              selectedKey={categoryFilterKey}
              loading={itemCategoriesLoading}
              palette={palette}
              onSelectCategory={setCategoryFilterKey}
              onArrangeOrder={navigateArrangeOrder}
              arrangeDisabled={!selectedShopId}
            />
            <FilterBar
              workspace={AdminItemWorkspace.Shop}
              search={search}
              palette={palette}
              onChangeSearch={setSearch}
              onCreate={openAvailableCatalogue}
            />
            <StatsStrip counts={shopItemsState.counts} totalCount={shopItemsState.totalCount} palette={palette} />
          </YStack>
        }
        renderItem={(item) => {
          const actions = itemActions(item);
          return (
            <ItemRow
              item={item}
              palette={palette}
              primaryAction={actions.primary}
              secondaryActions={actions.secondary}
              thumbnailSize={60}
              actionsPlacement="side"
            />
          );
        }}
      />
    );
  };

  const renderPrices = () => {
    if (!selectedShop) {
      return (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + insets.bottom }]}
          style={{ backgroundColor: palette.background }}
        >
          {commonHeader}
          <EmptyState
            title="Select a shop"
            message="Choose a shop before setting daily item prices."
            icon="store-alert-outline"
            palette={palette}
          />
        </ScrollView>
      );
    }
    return (
      <>
        <View style={[styles.fixedHeader, { backgroundColor: palette.background }]}>
          {commonHeader}
        </View>
        <PriceGrid
          items={priceState.bootstrap?.items ?? []}
          loading={priceState.loading}
          refreshing={priceHistoryOpen ? priceHistoryLoading : priceState.refreshing}
          draftPrices={priceState.draftPrices}
          savingAll={priceState.savingAll}
          savingItemId={priceState.savingItemId}
          error={priceState.error}
          selectedShop={selectedShop}
          historyOpen={priceHistoryOpen}
          historyDate={priceHistoryDate}
          historyMonth={priceHistoryMonth}
          historyItems={priceHistoryBootstrap?.items ?? []}
          historyLoading={priceHistoryLoading}
          historyError={priceHistoryError}
          palette={palette}
          bottomPadding={48 + insets.bottom}
          onRefresh={priceHistoryOpen ? refreshPriceHistory : refreshPrices}
          onBackToItems={() => navigation.navigate("AdminShopItems", { shopId: selectedShop.id })}
          onToggleHistory={togglePriceHistory}
          onChangeHistoryMonth={setPriceHistoryMonth}
          onSelectHistoryDate={selectPriceHistoryDate}
          onRefreshHistory={refreshPriceHistory}
          onChangeDraftPrice={priceState.setDraftPrice}
          onSaveRow={savePriceRow}
          onSaveEdited={saveEditedPrices}
          onCompleteToday={completeTodayPrices}
        />
      </>
    );
  };

  const title =
    workspace === AdminItemWorkspace.Catalogue
      ? "Catalogue"
      : workspace === AdminItemWorkspace.Assumption
        ? "Assumption"
        : workspace === AdminItemWorkspace.Prices
          ? "Prices"
          : "Shop items";
  const subtitle =
    workspace === AdminItemWorkspace.Catalogue || workspace === AdminItemWorkspace.Assumption
      ? "Global item workspace"
      : selectedShop?.name ?? "Choose a shop";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("AdminDashboard")} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {subtitle}
          </Text>
        </View>
        <AdminHeaderActions
          refreshing={headerRefreshing}
          onRefresh={refreshCurrentItemsPage}
        />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={styles.keyboardAvoid}
      >
        {workspace === AdminItemWorkspace.Catalogue
          ? renderCatalogue()
          : workspace === AdminItemWorkspace.Assumption
            ? renderAssumption()
            : workspace === AdminItemWorkspace.Prices
              ? renderPrices()
              : renderShopItems()}
      </KeyboardAvoidingView>
      <ToastBanner toast={toast} palette={palette} animatedValue={toastAnimation} />
    </SafeAreaView>
  );
}

export function AdminItemsCatalogueScreen(props: AdminItemsCatalogueScreenProps) {
  return <AdminItemsRoute {...props} workspace={AdminItemWorkspace.Catalogue} />;
}

export function AdminItemAssumptionScreen(props: AdminItemAssumptionScreenProps) {
  return <AdminItemsRoute {...props} workspace={AdminItemWorkspace.Assumption} />;
}

export function AdminShopItemsScreen(props: AdminShopItemsScreenProps) {
  return <AdminItemsRoute {...props} workspace={AdminItemWorkspace.Shop} />;
}

export function AdminItemPricesScreen(props: AdminItemPricesScreenProps) {
  return <AdminItemsRoute {...props} workspace={AdminItemWorkspace.Prices} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  topBar: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  scrollContent: {
    gap: 12,
    padding: 16,
  },
  fixedHeader: {
    padding: 16,
    paddingBottom: 0,
  },
});
