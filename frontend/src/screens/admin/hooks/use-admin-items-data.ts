import { useCallback, useEffect, useRef, useState } from "react";

import {
  allocateShopItems,
  deallocateShopItem,
  deleteItem,
  deleteShopItem,
  fetchCatalogueItemCounts,
  fetchCatalogueItemRows,
  fetchSelectedShopItemCounts,
  fetchSelectedShopItemRows,
  fetchShopItemImportCandidateCounts,
  fetchShopItemImportCandidateRows,
  fetchShopPriceBootstrap,
  fetchShops,
  saveEditedShopDailyPrices,
  saveShopDailyPrice,
  saveShopDailyPrices,
  type ApiRequestOptions,
  type ConfirmDeletePayload,
  type FetchShopItemsParams,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError, formatApiErrorMessage } from "@/api/client";
import { ItemScope, type DailyPriceCreate } from "@/types/api";
import type {
  AdminItemRowsPage,
  ShopBootstrapResponse,
  ShopItemCounts,
  ShopItemRead,
  ShopRead,
  UUID,
} from "@/types/api";

type ItemPageState = {
  items: ShopItemRead[];
  counts: ShopItemCounts | null;
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  countsLoading: boolean;
  error: string | null;
  cursor: {
    group: number | null;
    sortOrder: number | null;
    name: string | null;
    id: UUID | null;
  };
};

const EMPTY_PAGE_STATE: ItemPageState = {
  items: [],
  counts: null,
  totalCount: 0,
  hasMore: false,
  loading: false,
  refreshing: false,
  loadingMore: false,
  countsLoading: false,
  error: null,
  cursor: { group: null, sortOrder: null, name: null, id: null },
};

function toRowsState(page: AdminItemRowsPage): Pick<
  ItemPageState,
  "items" | "hasMore" | "cursor"
> {
  return {
    items: page.items,
    hasMore: page.has_more,
    cursor: {
      group: page.next_cursor_group ?? null,
      sortOrder: page.next_cursor_sort_order ?? null,
      name: page.next_cursor_name ?? null,
      id: page.next_cursor_id ?? null,
    },
  };
}

function listUniqueIds(itemIds: UUID[]) {
  return Array.from(new Set(itemIds));
}

type RowPageFetcher = (
  params?: FetchShopItemsParams,
  options?: ApiRequestOptions,
) => Promise<AdminItemRowsPage>;
type CountFetcher = (
  params?: FetchShopItemsParams,
  options?: ApiRequestOptions,
) => Promise<ShopItemCounts>;

const COUNT_REQUEST_DEBOUNCE_MS = 180;

function useRowFirstItemPage({
  enabled,
  resetKey,
  fetchRowsPage,
  fetchCountsPage,
}: {
  enabled: boolean;
  resetKey: string;
  fetchRowsPage: RowPageFetcher;
  fetchCountsPage: CountFetcher;
}) {
  const [state, setState] = useState<ItemPageState>(EMPTY_PAGE_STATE);
  const paramsRef = useRef<FetchShopItemsParams>({});
  const rowsRequestIdRef = useRef(0);
  const countsRequestIdRef = useRef(0);
  const rowsAbortRef = useRef<AbortController | null>(null);
  const countsAbortRef = useRef<AbortController | null>(null);
  const countsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearCountsTimer = useCallback(() => {
    if (countsDebounceRef.current) {
      clearTimeout(countsDebounceRef.current);
      countsDebounceRef.current = null;
    }
  }, []);

  const abortRows = useCallback(() => {
    rowsAbortRef.current?.abort();
    rowsAbortRef.current = null;
  }, []);

  const abortCounts = useCallback(() => {
    countsAbortRef.current?.abort();
    countsAbortRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearCountsTimer();
      abortRows();
      abortCounts();
    };
  }, [abortCounts, abortRows, clearCountsTimer]);

  useEffect(() => {
    rowsRequestIdRef.current += 1;
    countsRequestIdRef.current += 1;
    paramsRef.current = {};
    clearCountsTimer();
    abortRows();
    abortCounts();
    setState(EMPTY_PAGE_STATE);
  }, [abortCounts, abortRows, clearCountsTimer, resetKey]);

  useEffect(() => {
    if (enabled) {
      return;
    }
    rowsRequestIdRef.current += 1;
    countsRequestIdRef.current += 1;
    paramsRef.current = {};
    clearCountsTimer();
    abortRows();
    abortCounts();
    setState(EMPTY_PAGE_STATE);
  }, [abortCounts, abortRows, clearCountsTimer, enabled]);

  const loadCounts = useCallback(async (params: FetchShopItemsParams = {}) => {
    if (!enabled) {
      return null;
    }
    clearCountsTimer();
    abortCounts();
    const controller = new AbortController();
    countsAbortRef.current = controller;
    const requestId = ++countsRequestIdRef.current;
    setState((current) => ({ ...current, countsLoading: true }));
    try {
      const counts = await fetchCountsPage(params, { signal: controller.signal });
      if (mountedRef.current && requestId === countsRequestIdRef.current) {
        setState((current) => ({
          ...current,
          counts,
          totalCount: counts.all,
          countsLoading: false,
        }));
      }
      return counts;
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return null;
      }
      if (mountedRef.current && requestId === countsRequestIdRef.current) {
        setState((current) => ({ ...current, countsLoading: false }));
      }
      return null;
    } finally {
      if (countsAbortRef.current === controller) {
        countsAbortRef.current = null;
      }
    }
  }, [abortCounts, clearCountsTimer, enabled, fetchCountsPage]);

  const scheduleCounts = useCallback((params: FetchShopItemsParams = {}) => {
    if (!enabled) {
      return;
    }
    clearCountsTimer();
    countsDebounceRef.current = setTimeout(() => {
      countsDebounceRef.current = null;
      void loadCounts(params);
    }, COUNT_REQUEST_DEBOUNCE_MS);
    setState((current) => ({ ...current, countsLoading: true }));
  }, [clearCountsTimer, enabled, loadCounts]);

  const load = useCallback(async (params: FetchShopItemsParams = {}, isRefresh = false) => {
    if (!enabled) {
      setState(EMPTY_PAGE_STATE);
      return null;
    }
    clearCountsTimer();
    abortRows();
    abortCounts();
    const controller = new AbortController();
    rowsAbortRef.current = controller;
    const requestId = ++rowsRequestIdRef.current;
    const query = { ...params, limit: params.limit ?? 50 };
    paramsRef.current = query;
    setState((current) => ({
      ...current,
      loading: !isRefresh,
      refreshing: isRefresh,
      loadingMore: false,
      countsLoading: true,
      counts: isRefresh ? current.counts : null,
      totalCount: isRefresh ? current.totalCount : 0,
      error: null,
    }));
    try {
      const page = await fetchRowsPage(query, { signal: controller.signal });
      if (mountedRef.current && requestId === rowsRequestIdRef.current) {
        setState((current) => ({
          ...current,
          ...toRowsState(page),
          totalCount: current.counts?.all ?? page.items.length,
          loading: false,
          refreshing: false,
          error: null,
        }));
        scheduleCounts(query);
      }
      return page;
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return null;
      }
      const message = formatApiErrorMessage(requestError);
      if (mountedRef.current && requestId === rowsRequestIdRef.current) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: message,
        }));
      }
      throw new Error(message);
    } finally {
      if (rowsAbortRef.current === controller) {
        rowsAbortRef.current = null;
      }
    }
  }, [abortCounts, abortRows, clearCountsTimer, enabled, fetchRowsPage, scheduleCounts]);

  const refresh = useCallback(() => load(paramsRef.current, true), [load]);

  const loadMore = useCallback(async () => {
    if (!enabled || state.loadingMore || !state.hasMore || !state.cursor.name || !state.cursor.id) {
      return null;
    }
    abortRows();
    const controller = new AbortController();
    rowsAbortRef.current = controller;
    const requestId = ++rowsRequestIdRef.current;
    setState((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const page = await fetchRowsPage({
        ...paramsRef.current,
        cursor_group: state.cursor.group,
        cursor_sort_order: state.cursor.sortOrder,
        cursor_name: state.cursor.name,
        cursor_id: state.cursor.id,
      }, { signal: controller.signal });
      if (mountedRef.current && requestId === rowsRequestIdRef.current) {
        setState((current) => {
          const existingIds = new Set(current.items.map((item) => item.id));
          return {
            ...current,
            items: [...current.items, ...page.items.filter((item) => !existingIds.has(item.id))],
            hasMore: page.has_more,
            cursor: {
              group: page.next_cursor_group ?? null,
              sortOrder: page.next_cursor_sort_order ?? null,
              name: page.next_cursor_name ?? null,
              id: page.next_cursor_id ?? null,
            },
            loadingMore: false,
          };
        });
      }
      return page;
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return null;
      }
      const message = formatApiErrorMessage(requestError);
      if (mountedRef.current && requestId === rowsRequestIdRef.current) {
        setState((current) => ({ ...current, loadingMore: false, error: message }));
      }
      throw new Error(message);
    } finally {
      if (rowsAbortRef.current === controller) {
        rowsAbortRef.current = null;
      }
    }
  }, [
    abortRows,
    enabled,
    fetchRowsPage,
    state.cursor.id,
    state.cursor.name,
    state.cursor.sortOrder,
    state.hasMore,
    state.loadingMore,
  ]);

  const removeItems = useCallback((itemIds: UUID[]) => {
    const removedIds = new Set(itemIds);
    setState((current) => {
      const items = current.items.filter((item) => !removedIds.has(item.id));
      const removedCount = current.items.length - items.length;
      return {
        ...current,
        items,
        totalCount: Math.max(0, current.totalCount - removedCount),
        counts: current.counts
          ? {
              ...current.counts,
              all: Math.max(0, current.counts.all - removedCount),
              available: Math.max(0, current.counts.available - removedCount),
              catalogue: Math.max(0, current.counts.catalogue - removedCount),
            }
          : current.counts,
      };
    });
  }, []);

  return {
    ...state,
    load,
    refresh,
    refreshCounts: () => loadCounts(paramsRef.current),
    loadMore,
    removeItems,
  };
}

export function useAdminItemShops(enabled = true) {
  const [shops, setShops] = useState<ShopRead[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return [];
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const nextShops = await fetchShops({ signal: controller.signal });
      if (mountedRef.current && requestId === requestIdRef.current) {
        setShops(nextShops);
        setError(null);
      }
      return nextShops;
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return [];
      }
      const message = formatApiErrorMessage(requestError);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(message);
      }
      throw new Error(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      requestIdRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }
    void load().catch(() => undefined);
  }, [enabled, load]);

  return { shops, loading, error, reload: load };
}

export function useCatalogueItems(enabled = true) {
  const page = useRowFirstItemPage({
    enabled,
    resetKey: "catalogue",
    fetchRowsPage: fetchCatalogueItemRows,
    fetchCountsPage: fetchCatalogueItemCounts,
  });

  const remove = useCallback(async (itemId: UUID, credentials: ConfirmDeletePayload) => {
    try {
      await deleteItem(itemId, credentials);
      await page.refresh();
    } catch (requestError) {
      throw new Error(formatApiErrorMessage(requestError));
    }
  }, [page]);

  return {
    ...page,
    deleteItem: remove,
  };
}

export function useSelectedShopItems(shopId: UUID | null, enabled = true) {
  const fetchRowsPage = useCallback((params?: FetchShopItemsParams, options?: ApiRequestOptions) => {
    if (!shopId) {
      return Promise.resolve({
        items: [],
        limit: params?.limit ?? 50,
        has_more: false,
      });
    }
    return fetchSelectedShopItemRows(shopId, params, options);
  }, [shopId]);
  const fetchCountsPage = useCallback((params?: FetchShopItemsParams, options?: ApiRequestOptions) => {
    if (!shopId) {
      return Promise.resolve({
        all: 0,
        allocated: 0,
        available: 0,
        catalogue: 0,
        shop: 0,
        priced: 0,
        needs_price: 0,
        stale_price: 0,
        paused: 0,
      });
    }
    return fetchSelectedShopItemCounts(shopId, params, options);
  }, [shopId]);
  const page = useRowFirstItemPage({
    enabled: enabled && Boolean(shopId),
    resetKey: shopId ?? "no-shop",
    fetchRowsPage,
    fetchCountsPage,
  });

  const deallocate = useCallback(async (itemId: UUID) => {
    if (!shopId) {
      throw new Error("Select a shop before removing items.");
    }
    try {
      await deallocateShopItem(shopId, itemId);
      await page.refresh();
    } catch (requestError) {
      throw new Error(formatApiErrorMessage(requestError));
    }
  }, [page, shopId]);

  const remove = useCallback(async (item: ShopItemRead, credentials: ConfirmDeletePayload) => {
    if (!shopId) {
      throw new Error("Select a shop before deleting items.");
    }
    try {
      if (item.scope === ItemScope.Shop) {
        await deleteShopItem(shopId, item.id, credentials);
      } else {
        throw new Error("Remove catalogue items from this shop instead of deleting the global catalogue record.");
      }
      await page.refresh();
    } catch (requestError) {
      throw new Error(formatApiErrorMessage(requestError));
    }
  }, [page, shopId]);

  return {
    ...page,
    deallocate,
    deleteItem: remove,
  };
}

export function useAvailableCatalogueItems(shopId: UUID | null, enabled = true) {
  const [importingIds, setImportingIds] = useState<Set<UUID>>(() => new Set());
  const fetchRowsPage = useCallback((params?: FetchShopItemsParams, options?: ApiRequestOptions) => {
    if (!shopId) {
      return Promise.resolve({
        items: [],
        limit: params?.limit ?? 50,
        has_more: false,
      });
    }
    return fetchShopItemImportCandidateRows(shopId, params, options);
  }, [shopId]);
  const fetchCountsPage = useCallback((params?: FetchShopItemsParams, options?: ApiRequestOptions) => {
    if (!shopId) {
      return Promise.resolve({
        all: 0,
        allocated: 0,
        available: 0,
        catalogue: 0,
        shop: 0,
        priced: 0,
        needs_price: 0,
        stale_price: 0,
        paused: 0,
      });
    }
    return fetchShopItemImportCandidateCounts(shopId, params, options);
  }, [shopId]);
  const page = useRowFirstItemPage({
    enabled: enabled && Boolean(shopId),
    resetKey: shopId ?? "no-shop",
    fetchRowsPage,
    fetchCountsPage,
  });

  useEffect(() => {
    setImportingIds(new Set());
  }, [shopId]);

  const importItems = useCallback(async (itemIds: UUID[]) => {
    if (!shopId) {
      throw new Error("Select a shop before importing items.");
    }
    const uniqueItemIds = listUniqueIds(itemIds);
    if (uniqueItemIds.length === 0) {
      throw new Error("Select at least one catalogue item.");
    }

    setImportingIds((current) => {
      const next = new Set(current);
      uniqueItemIds.forEach((itemId) => next.add(itemId));
      return next;
    });
    try {
      const result = await allocateShopItems(shopId, uniqueItemIds);
      page.removeItems(result.item_ids);
      await page.refreshCounts();
      return result;
    } catch (requestError) {
      throw new Error(formatApiErrorMessage(requestError));
    } finally {
      setImportingIds((current) => {
        const next = new Set(current);
        uniqueItemIds.forEach((itemId) => next.delete(itemId));
        return next;
      });
    }
  }, [page, shopId]);

  return {
    ...page,
    importingIds,
    importing: importingIds.size > 0,
    importItems,
  };
}

export function useShopPrices(shopId: UUID | null, enabled = true) {
  const [bootstrap, setBootstrap] = useState<ShopBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savingItemId, setSavingItemId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftPrices, setDraftPrices] = useState<Record<UUID, string>>({});
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (!enabled || !shopId) {
      setBootstrap(null);
      setLoading(false);
      setRefreshing(false);
      return null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const nextBootstrap = await fetchShopPriceBootstrap(shopId, { signal: controller.signal });
      if (mountedRef.current && requestId === requestIdRef.current) {
        setBootstrap(nextBootstrap);
        setError(null);
      }
      return nextBootstrap;
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return null;
      }
      const message = formatApiErrorMessage(requestError);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(message);
      }
      throw new Error(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled, shopId]);

  useEffect(() => {
    setDraftPrices({});
    if (!enabled || !shopId) {
      abortRef.current?.abort();
      requestIdRef.current += 1;
      setBootstrap(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    void load().catch(() => undefined);
  }, [enabled, load, shopId]);

  const setDraftPrice = useCallback((itemId: UUID, rawValue: string) => {
    setDraftPrices((current) => ({
      ...current,
      [itemId]: rawValue.replace(/[^\d.]/g, ""),
    }));
  }, []);

  const clearDraftPrice = useCallback((itemId: UUID) => {
    setDraftPrices((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }, []);

  const saveRow = useCallback(async (itemId: UUID, pricePerUnit: string) => {
    if (!shopId) {
      throw new Error("Select a shop before saving prices.");
    }
    setSavingItemId(itemId);
    setError(null);
    try {
      await saveShopDailyPrice(shopId, itemId, { price_per_unit: pricePerUnit });
      clearDraftPrice(itemId);
      return await load(true);
    } catch (requestError) {
      const message = formatApiErrorMessage(requestError);
      setError(message);
      throw new Error(message);
    } finally {
      setSavingItemId(null);
    }
  }, [clearDraftPrice, load, shopId]);

  const saveAll = useCallback(async (entries: DailyPriceCreate["entries"]) => {
    if (!shopId) {
      throw new Error("Select a shop before saving prices.");
    }
    setSavingAll(true);
    setError(null);
    try {
      await saveShopDailyPrices(shopId, { entries });
      setDraftPrices({});
      return await load(true);
    } catch (requestError) {
      const message = formatApiErrorMessage(requestError);
      setError(message);
      throw new Error(message);
    } finally {
      setSavingAll(false);
    }
  }, [load, shopId]);

  const saveRows = useCallback(async (entries: DailyPriceCreate["entries"]) => {
    if (!shopId) {
      throw new Error("Select a shop before saving prices.");
    }
    if (entries.length === 0) {
      return await load(true);
    }
    setSavingAll(true);
    setError(null);
    try {
      await saveEditedShopDailyPrices(shopId, { entries });
      setDraftPrices((current) => {
        const next = { ...current };
        for (const entry of entries) {
          delete next[entry.item_id];
        }
        return next;
      });
      return await load(true);
    } catch (requestError) {
      const message = formatApiErrorMessage(requestError);
      setError(message);
      throw new Error(message);
    } finally {
      setSavingAll(false);
    }
  }, [load, shopId]);

  return {
    bootstrap,
    draftPrices,
    error,
    loading,
    refreshing,
    savingAll,
    savingItemId,
    load,
    setDraftPrice,
    saveRow,
    saveRows,
    saveAll,
  };
}
