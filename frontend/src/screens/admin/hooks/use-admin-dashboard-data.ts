import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AnalyticsDateRange,
  createShop,
  deleteShop,
  fetchAdminBillDetail,
  fetchDailyBills,
  fetchDashboardBootstrap,
  updateShop,
  updateShopStatus,
} from "@/api/admin";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import type {
  AdminBillSummary,
  AnalyticsPeriod,
  BillRead,
  ItemSalesSummary,
  OrganizationBranchQuota,
  PaymentSplitSummary,
  ShopRead,
  ShopSalesSummary,
  ShopUpdate,
  UUID,
} from "@/types/api";

import { getShopStatus, type ShopOperationalState } from "../admin-dashboard-utils";

const BILL_PAGE_SIZE = 50;

export type ShopDashboardRow = {
  shop: ShopRead;
  totalSales: string;
  cashTotal: string;
  upiTotal: string;
  expenseCashTotal: string;
  expenseUpiTotal: string;
  purchaseTotal: string;
  billCount: number;
  lastActivityAt: string | null;
  status: ShopOperationalState;
};

type CreateBranchInput = {
  name: string;
  username: string;
  password: string;
};

type UpdateBranchInput = ShopUpdate;

type UseAdminDashboardDataOptions = {
  analyticsPeriod: AnalyticsPeriod;
  analyticsReferenceDate: string;
  analyticsRange?: AnalyticsDateRange;
  selectedShopId: UUID | null;
};

export function useAdminDashboardData({
  analyticsPeriod,
  analyticsReferenceDate,
  analyticsRange,
  selectedShopId,
}: UseAdminDashboardDataOptions) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineSnapshot, setIsOfflineSnapshot] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    shops: ShopRead[];
    salesSummary: ShopSalesSummary[];
    paymentSummary: PaymentSplitSummary[];
    dailyBillStats: { shopId: UUID; billCount: number; lastBillAt: string | null }[];
    largestBill: AdminBillSummary | null;
    itemSales: ItemSalesSummary[];
    branchQuota: OrganizationBranchQuota;
  }>({
    shops: [],
    salesSummary: [],
    paymentSummary: [],
    dailyBillStats: [],
    largestBill: null,
    itemSales: [],
    branchQuota: {
      max_branches: 0,
      branch_count: 0,
      remaining_branches: 0,
      can_create_branch: true,
    },
  });

  const [dailyBills, setDailyBills] = useState<AdminBillSummary[]>([]);
  const [dailyBillsTotalCount, setDailyBillsTotalCount] = useState(0);
  const [dailyBillsCursor, setDailyBillsCursor] = useState<{ createdAt: string | null; id: UUID | null }>({
    createdAt: null,
    id: null,
  });
  const [dailyBillsHasMore, setDailyBillsHasMore] = useState(false);
  const [dailyBillsLoadingMore, setDailyBillsLoadingMore] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const mountedRef = useRef(true);
  const dashboardRequestIdRef = useRef(0);
  const dailyBillsLoadMoreInFlightRef = useRef(false);
  const billDetailCacheRef = useRef(new Map<UUID, BillRead>());
  const billDetailRequestRef = useRef(new Map<UUID, Promise<BillRead>>());

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    const requestId = ++dashboardRequestIdRef.current;

    if (isRefresh) {
      setRefreshing(true);
    } else if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }

    try {
      const data = await fetchDashboardBootstrap(
        analyticsPeriod,
        analyticsReferenceDate,
        selectedShopId,
        BILL_PAGE_SIZE,
        analyticsRange,
      );

      if (!mountedRef.current || requestId !== dashboardRequestIdRef.current) {
        return;
      }

      setDashboardData({
        shops: data.shops,
        salesSummary: data.sales_summary,
        paymentSummary: data.payment_summary,
        dailyBillStats: data.bills.shop_stats.map((stat) => ({
          shopId: stat.shop_id,
          billCount: stat.bill_count,
          lastBillAt: stat.last_bill_at ?? null,
        })),
        largestBill: data.bills.largest_bill ?? null,
        itemSales: data.item_sales,
        branchQuota: data.branch_quota,
      });

      setDailyBills(data.bills.items);
      setDailyBillsTotalCount(data.bills.total_count);
      setDailyBillsHasMore(data.bills.has_more);
      setDailyBillsCursor({
        createdAt: data.bills.next_cursor_created_at ?? null,
        id: data.bills.next_cursor_id ?? null,
      });
      setDailyBillsLoadingMore(false);
      setLastSyncAt(new Date().toISOString());
      setIsOfflineSnapshot(false);
      setDashboardError(null);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (!mountedRef.current || requestId !== dashboardRequestIdRef.current) {
        return;
      }

      setIsOfflineSnapshot(true);
      setDashboardError(formatApiErrorMessage(error));
    } finally {
      if (!mountedRef.current || requestId !== dashboardRequestIdRef.current) {
        return;
      }

      setLoading(false);
      setRefreshing(false);
    }
  }, [analyticsPeriod, analyticsRange, analyticsReferenceDate, selectedShopId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadMoreBills = useCallback(async () => {
    if (
      dailyBillsLoadingMore ||
      dailyBillsLoadMoreInFlightRef.current ||
      !dailyBillsHasMore ||
      dailyBillsCursor.createdAt === null ||
      dailyBillsCursor.id === null
    ) {
      return;
    }

    dailyBillsLoadMoreInFlightRef.current = true;
    setDailyBillsLoadingMore(true);
    try {
      const nextPage = await fetchDailyBills(
        analyticsPeriod,
        analyticsReferenceDate,
        selectedShopId,
        BILL_PAGE_SIZE,
        dailyBillsCursor.createdAt,
        dailyBillsCursor.id,
        analyticsRange,
      );

      setDailyBills((current) => {
        const existingIds = new Set(current.map((bill) => bill.bill_id));
        const nextItems = nextPage.items.filter((bill) => !existingIds.has(bill.bill_id));
        return [...current, ...nextItems];
      });
      setDailyBillsHasMore(nextPage.has_more);
      setDailyBillsCursor({
        createdAt: nextPage.next_cursor_created_at ?? null,
        id: nextPage.next_cursor_id ?? null,
      });
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    } finally {
      dailyBillsLoadMoreInFlightRef.current = false;
      setDailyBillsLoadingMore(false);
    }
  }, [
    analyticsPeriod,
    analyticsRange,
    analyticsReferenceDate,
    dailyBillsCursor.createdAt,
    dailyBillsCursor.id,
    dailyBillsHasMore,
    dailyBillsLoadingMore,
    selectedShopId,
  ]);

  const applyShopUpdate = useCallback((updatedShop: ShopRead) => {
    setDashboardData((current) => ({
      ...current,
      shops: current.shops.map((shop) => (shop.id === updatedShop.id ? updatedShop : shop)),
    }));
    setLastSyncAt(new Date().toISOString());
    setIsOfflineSnapshot(false);
    setDashboardError(null);
  }, []);

  const billCountByShopId = useMemo(
    () => new Map(dashboardData.dailyBillStats.map((stat) => [stat.shopId, stat.billCount])),
    [dashboardData.dailyBillStats],
  );

  const salesByShopId = useMemo(
    () =>
      new Map(
        dashboardData.salesSummary.map((item) => [
          item.shop_id,
          {
            totalSales: item.total_sales,
            expenseCashTotal: item.expense_cash_total ?? "0",
            expenseUpiTotal: item.expense_upi_total ?? "0",
            purchaseTotal: item.purchase_amount ?? "0",
          },
        ]),
      ),
    [dashboardData.salesSummary],
  );

  const paymentsByShopId = useMemo(
    () =>
      new Map(
        dashboardData.paymentSummary.map((item) => [
          item.shop_id,
          { cashTotal: item.cash_total, upiTotal: item.upi_total },
        ]),
      ),
    [dashboardData.paymentSummary],
  );

  const shopRows = useMemo<ShopDashboardRow[]>(() => {
    return dashboardData.shops.map((shop) => {
      const payment = paymentsByShopId.get(shop.id);
      const lastActivityAt = shop.last_active_at ?? null;

      return {
        shop,
        totalSales: salesByShopId.get(shop.id)?.totalSales ?? "0",
        cashTotal: payment?.cashTotal ?? "0",
        upiTotal: payment?.upiTotal ?? "0",
        expenseCashTotal: salesByShopId.get(shop.id)?.expenseCashTotal ?? "0",
        expenseUpiTotal: salesByShopId.get(shop.id)?.expenseUpiTotal ?? "0",
        purchaseTotal: salesByShopId.get(shop.id)?.purchaseTotal ?? "0",
        billCount: billCountByShopId.get(shop.id) ?? 0,
        lastActivityAt,
        status: getShopStatus(shop, lastActivityAt),
      };
    });
  }, [billCountByShopId, paymentsByShopId, salesByShopId, dashboardData.shops]);

  const selectedShopName = useMemo(
    () => (selectedShopId ? dashboardData.shops.find((shop) => shop.id === selectedShopId)?.name ?? "Selected Branch" : "All Branches"),
    [selectedShopId, dashboardData.shops],
  );

  const visibleShopRows = useMemo(
    () => (selectedShopId ? shopRows.filter((row) => row.shop.id === selectedShopId) : shopRows),
    [selectedShopId, shopRows],
  );

  const createBranch = useCallback(async (values: CreateBranchInput) => {
    try {
      await createShop(values);
      await loadDashboard(true);
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    }
  }, [loadDashboard]);

  const toggleBranchStatus = useCallback(async (shop: ShopRead, isActive: boolean) => {
    try {
      const updatedShop = await updateShopStatus(shop.id, { is_active: isActive });
      applyShopUpdate(updatedShop);
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    }
  }, [applyShopUpdate]);

  const updateBranch = useCallback(async (shop: ShopRead, values: UpdateBranchInput) => {
    try {
      const updatedShop = await updateShop(shop.id, values);
      applyShopUpdate(updatedShop);
      return updatedShop;
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    }
  }, [applyShopUpdate]);

  const deleteBranch = useCallback(async (shop: ShopRead) => {
    try {
      await deleteShop(shop.id);
      await loadDashboard(true);
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    }
  }, [loadDashboard]);

  const loadBillDetail = useCallback(async (billId: UUID): Promise<BillRead> => {
    const cachedBill = billDetailCacheRef.current.get(billId);
    if (cachedBill) {
      return cachedBill;
    }

    const existingRequest = billDetailRequestRef.current.get(billId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      try {
        const bill = await fetchAdminBillDetail(billId);
        billDetailCacheRef.current.set(billId, bill);
        return bill;
      } catch (error) {
        throw new Error(formatApiErrorMessage(error));
      } finally {
        billDetailRequestRef.current.delete(billId);
      }
    })();

    billDetailRequestRef.current.set(billId, request);

    try {
      return await request;
    } catch (error) {
      throw new Error(formatApiErrorMessage(error));
    }
  }, []);

  return {
    createBranch,
    dailyBills,
    dailyBillsHasMore,
    dailyBillsLoadingMore,
    dailyBillsTotalCount,
    dashboardError,
    isOfflineSnapshot,
    itemSales: dashboardData.itemSales,
    largestBill: dashboardData.largestBill,
    lastSyncAt,
    loadBillDetail,
    loadDashboard,
    loadMoreBills,
    loading,
    paymentSummary: dashboardData.paymentSummary,
    refreshing,
    salesSummary: dashboardData.salesSummary,
    selectedShopName,
    shopRows,
    shops: dashboardData.shops,
    branchQuota: dashboardData.branchQuota,
    updateBranch,
    deleteBranch,
    toggleBranchStatus,
    visibleShopRows,
  };
}
