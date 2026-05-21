import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useMemo } from "react";

import type {
  AdminBillSummary,
  AnalyticsPeriod,
  ItemSalesSummary,
  ShopBootstrapResponse,
  UUID,
} from "@/types/api";
import { isPositiveNumber, money } from "@/utils/decimal";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/format";

import type { ThemePalette } from "../admin-dashboard-theme";
import {
  formatAnalyticsReference,
} from "../admin-dashboard-utils";
import type { ShopDashboardRow } from "./use-admin-dashboard-data";

type Option = {
  value: string;
  label: string;
};

type PriceBootstrapItem = ShopBootstrapResponse["items"][number] & {
  current_price?: string | null;
};

export type MetricCardViewModel = {
  key: string;
  label: string;
  value: number;
  formatter: (value: number) => string;
  note: string;
  noteIcon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  accent: string;
  accentSoft: string;
  sparklineLabel: string;
  sparklineValues: number[];
};

export type BillingSection = {
  title: string;
  data: BillingSectionItem[];
};

export type BillingSectionItem = AdminBillSummary & {
  formattedAmount: string;
  formattedDateTime: string;
};

type UseAdminPriceEditorModelOptions = {
  priceBootstrap: ShopBootstrapResponse | null;
  selectedPriceItemId: UUID | null;
  draftPrices: Record<UUID, string>;
  selectedPriceShopId: UUID | null;
};

export function useAdminPriceEditorModel({
  priceBootstrap,
  selectedPriceItemId,
  draftPrices,
  selectedPriceShopId,
}: UseAdminPriceEditorModelOptions) {
  const currentPriceItem = useMemo<PriceBootstrapItem | null>(
    () => priceBootstrap?.items.find((item) => item.item_id === selectedPriceItemId) ?? null,
    [priceBootstrap, selectedPriceItemId],
  );

  const resolvePriceDraft = useCallback(
    (itemId: UUID, currentPrice?: string | null) => draftPrices[itemId] ?? currentPrice ?? "",
    [draftPrices],
  );

  const draftPrice = useMemo(() => {
    if (!currentPriceItem) {
      return "";
    }

    return resolvePriceDraft(currentPriceItem.item_id, currentPriceItem.current_price);
  }, [currentPriceItem, resolvePriceDraft]);

  const unresolvedPriceItems = useMemo(() => {
    if (!priceBootstrap) {
      return [];
    }

    return priceBootstrap.items.filter((item) => !isPositiveNumber(resolvePriceDraft(item.item_id, item.current_price)));
  }, [priceBootstrap, resolvePriceDraft]);

  const saveDisabled = !selectedPriceShopId || !isPositiveNumber(draftPrice.trim()) || unresolvedPriceItems.length > 0;

  const priceHelperText = useMemo(() => {
    if (!priceBootstrap) {
      return null;
    }

    if (unresolvedPriceItems.length === 0) {
      return "Every active item has a valid price. You can save this update now.";
    }

    const itemNames = unresolvedPriceItems.map((item) => item.item_name);
    const preview = itemNames.slice(0, 3).join(", ");
    const suffix = itemNames.length > 3 ? `, +${itemNames.length - 3} more` : "";
    return `Add starting prices for all active items before saving. Remaining: ${preview}${suffix}.`;
  }, [priceBootstrap, unresolvedPriceItems]);

  return {
    currentPriceItem,
    draftPrice,
    priceHelperText,
    resolvePriceDraft,
    saveDisabled,
    unresolvedPriceItems,
  };
}

type UseAdminDashboardAnalyticsOptions = {
  analyticsPeriod: AnalyticsPeriod;
  analyticsReferenceDate: string;
  selectedShopId: UUID | null;
  dateOptions: Option[];
  monthOptions: Option[];
  weekOptions: Option[];
  yearOptions: Option[];
  debouncedItemSearch: string;
  itemSales: ItemSalesSummary[];
  dailyBills: AdminBillSummary[];
  dailyBillsTotalCount: number;
  visibleShopRows: ShopDashboardRow[];
  largestBill: AdminBillSummary | null;
  palette: ThemePalette;
};

export function useAdminDashboardAnalytics({
  analyticsPeriod,
  analyticsReferenceDate,
  selectedShopId,
  dateOptions,
  monthOptions,
  weekOptions,
  yearOptions,
  debouncedItemSearch,
  itemSales,
  dailyBills,
  dailyBillsTotalCount,
  visibleShopRows,
  largestBill,
  palette,
}: UseAdminDashboardAnalyticsOptions) {
  const filteredItemSales = useMemo(
    () =>
      itemSales.filter((item) => {
        if (!debouncedItemSearch) {
          return true;
        }

        return `${item.item_name} ${item.base_unit}`.toLowerCase().includes(debouncedItemSearch);
      }),
    [debouncedItemSearch, itemSales],
  );

  const visibleBills = useMemo(() => {
    return selectedShopId ? dailyBills.filter((bill) => bill.shop_id === selectedShopId) : dailyBills;
  }, [dailyBills, selectedShopId]);

  const totalRevenue = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.totalSales)), money(0)),
    [visibleShopRows],
  );
  const totalCash = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.cashTotal)), money(0)),
    [visibleShopRows],
  );
  const totalUpi = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.upiTotal)), money(0)),
    [visibleShopRows],
  );
  const paymentTotal = useMemo(() => totalCash.plus(totalUpi), [totalCash, totalUpi]);
  const cashShare = paymentTotal.greaterThan(0) ? totalCash.div(paymentTotal).mul(100).toNumber() : 0;

  const visibleBillCount = useMemo(() => dailyBillsTotalCount, [dailyBillsTotalCount]);

  const itemRevenueAverage = useMemo(
    () =>
      filteredItemSales.length > 0
        ? filteredItemSales
            .reduce((sum, item) => sum.plus(money(item.total_amount)), money(0))
            .div(filteredItemSales.length)
            .toNumber()
        : 0,
    [filteredItemSales],
  );

  const branchRanking = useMemo(() => {
    const rankMap = new Map<UUID, number>();
    [...visibleShopRows]
      .sort((left, right) => money(right.totalSales).minus(left.totalSales).toNumber())
      .forEach((row, index) => rankMap.set(row.shop.id, index + 1));

    return rankMap;
  }, [visibleShopRows]);

  const billingSections = useMemo<BillingSection[]>(() => {
    const groups = new Map<string, BillingSectionItem[]>();

    for (const bill of visibleBills) {
      const title = formatDate(bill.created_at);
      const sectionItem: BillingSectionItem = {
        ...bill,
        formattedAmount: formatCurrency(bill.total_amount),
        formattedDateTime: formatDateTime(bill.created_at),
      };

      const entries = groups.get(title);
      if (entries) {
        entries.push(sectionItem);
      } else {
        groups.set(title, [sectionItem]);
      }
    }

    return Array.from(groups.entries(), ([title, data]) => ({
      title,
      data,
    }));
  }, [visibleBills]);

  const analyticsReferenceOptions = useMemo(() => {
    if (analyticsPeriod === "date") {
      return dateOptions;
    }

    if (analyticsPeriod === "month") {
      return monthOptions;
    }

    if (analyticsPeriod === "week") {
      return weekOptions;
    }

    return yearOptions;
  }, [analyticsPeriod, dateOptions, monthOptions, weekOptions, yearOptions]);

  const analyticsReferenceLabel = useMemo(
    () => formatAnalyticsReference(analyticsPeriod, analyticsReferenceDate),
    [analyticsPeriod, analyticsReferenceDate],
  );

  const metricSparklineValues = useMemo(() => {
    const revenue = visibleShopRows
      .map((row) => money(row.totalSales).toNumber())
      .filter((value) => value > 0)
      .sort((left, right) => right - left)
      .slice(0, 6);
    const bills = visibleShopRows
      .map((row) => row.billCount)
      .filter((value) => value > 0)
      .sort((left, right) => right - left)
      .slice(0, 6);
    const cash = visibleShopRows
      .map((row) => money(row.cashTotal).toNumber())
      .filter((value) => value > 0)
      .sort((left, right) => right - left)
      .slice(0, 6);
    const upi = visibleShopRows
      .map((row) => money(row.upiTotal).toNumber())
      .filter((value) => value > 0)
      .sort((left, right) => right - left)
      .slice(0, 6);

    return {
      revenue: revenue.length > 0 ? revenue : [0],
      bills: bills.length > 0 ? bills : [0],
      cash: cash.length > 0 ? cash : [0],
      upi: upi.length > 0 ? upi : [0],
    };
  }, [visibleShopRows]);

  const metricCards = useMemo<MetricCardViewModel[]>(
    () => [
      {
        key: "revenue",
        label: "Total Revenue",
        value: totalRevenue.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: `${analyticsReferenceLabel} revenue`,
        noteIcon: "calendar-range",
        icon: "cash-multiple",
        accent: palette.emerald,
        accentSoft: palette.emeraldSoft,
        sparklineLabel: "Top branches",
        sparklineValues: metricSparklineValues.revenue,
      },
      {
        key: "bills",
        label: "Number of Bills",
        value: visibleBillCount,
        formatter: (value: number) => `${Math.round(value)} Bills`,
        note: largestBill ? `Largest ${formatCurrency(largestBill.total_amount)}` : `No bills in ${analyticsReferenceLabel}`,
        noteIcon: largestBill ? "arrow-top-right" : "receipt-text-remove-outline",
        icon: "receipt-text-outline",
        accent: palette.gold,
        accentSoft: palette.goldSoft,
        sparklineLabel: "Branch volume",
        sparklineValues: metricSparklineValues.bills,
      },
      {
        key: "cash",
        label: "Cash Collection",
        value: totalCash.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: `${cashShare.toFixed(0)}% of collections`,
        noteIcon: "percent-outline",
        icon: "wallet-outline",
        accent: palette.cash,
        accentSoft: palette.cashSoft,
        sparklineLabel: "Cash share",
        sparklineValues: metricSparklineValues.cash,
      },
      {
        key: "upi",
        label: "UPI Collection",
        value: totalUpi.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: `${Math.max(0, 100 - cashShare).toFixed(0)}% digital mix`,
        noteIcon: "qrcode-scan",
        icon: "qrcode-scan",
        accent: palette.upi,
        accentSoft: palette.upiSoft,
        sparklineLabel: "Digital spread",
        sparklineValues: metricSparklineValues.upi,
      },
    ],
    [
      analyticsReferenceLabel,
      cashShare,
      largestBill,
      metricSparklineValues.bills,
      metricSparklineValues.cash,
      metricSparklineValues.revenue,
      metricSparklineValues.upi,
      palette.cash,
      palette.cashSoft,
      palette.emerald,
      palette.emeraldSoft,
      palette.gold,
      palette.goldSoft,
      palette.upi,
      palette.upiSoft,
      totalCash,
      totalRevenue,
      totalUpi,
      visibleBillCount,
    ],
  );

  return {
    analyticsReferenceLabel,
    analyticsReferenceOptions,
    billingSections,
    branchRanking,
    filteredItemSales,
    itemRevenueAverage,
    metricCards,
    visibleBillCount,
    visibleBills,
  };
}
