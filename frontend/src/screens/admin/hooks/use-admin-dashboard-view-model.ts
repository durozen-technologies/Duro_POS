import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useMemo } from "react";

import { useAdminTranslation } from "@/hooks/use-admin-translation";
import {
  AnalyticsPeriod,
  type AdminBillSummary,
  type ItemSalesSummary,
  type ShopBootstrapResponse,
  type UUID,
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
  analyticsRange?: { startDate?: string | null; endDate?: string | null };
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
  totalOutstandingDue: string;
  largestBill: AdminBillSummary | null;
  palette: ThemePalette;
};

export function useAdminDashboardAnalytics({
  analyticsPeriod,
  analyticsReferenceDate,
  analyticsRange,
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
  totalOutstandingDue: totalOutstandingDueRaw,
  largestBill,
  palette,
}: UseAdminDashboardAnalyticsOptions) {
  const { t } = useAdminTranslation();
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
  const totalOutstandingDue = useMemo(() => money(totalOutstandingDueRaw), [totalOutstandingDueRaw]);
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
  const totalExpenseCash = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.expenseCashTotal)), money(0)),
    [visibleShopRows],
  );
  const totalExpenseUpi = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.expenseUpiTotal)), money(0)),
    [visibleShopRows],
  );
  const totalExpense = useMemo(
    () => totalExpenseCash.plus(totalExpenseUpi),
    [totalExpenseCash, totalExpenseUpi],
  );
  const totalPurchase = useMemo(
    () => visibleShopRows.reduce((sum, row) => sum.plus(money(row.purchaseTotal)), money(0)),
    [visibleShopRows],
  );
  const totalRemainingBalance = useMemo(
    () => totalRevenue.minus(totalExpense).minus(totalPurchase),
    [totalExpense, totalPurchase, totalRevenue],
  );
  const remainingCash = useMemo(() => totalCash.minus(totalExpenseCash), [totalCash, totalExpenseCash]);
  const remainingUpi = useMemo(() => totalUpi.minus(totalExpenseUpi), [totalExpenseUpi, totalUpi]);

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
    if (analyticsPeriod === AnalyticsPeriod.DATE) {
      return dateOptions;
    }

    if (analyticsPeriod === AnalyticsPeriod.MONTH) {
      return monthOptions;
    }

    if (analyticsPeriod === AnalyticsPeriod.WEEK) {
      return weekOptions;
    }

    return yearOptions;
  }, [analyticsPeriod, dateOptions, monthOptions, weekOptions, yearOptions]);

  const analyticsReferenceLabel = useMemo(
    () => formatAnalyticsReference(analyticsPeriod, analyticsReferenceDate, analyticsRange),
    [analyticsPeriod, analyticsRange, analyticsReferenceDate],
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
        label: t("dashboard.totalPaidAmount"),
        value: totalRevenue.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.paidCollections", { reference: analyticsReferenceLabel }),
        noteIcon: "calendar-range",
        icon: "cash-multiple",
        accent: palette.billing,
        accentSoft: palette.billingSoft,
        sparklineLabel: t("dashboard.topBranches"),
        sparklineValues: metricSparklineValues.revenue,
      },
      {
        key: "bills",
        label: t("dashboard.numberOfBills"),
        value: visibleBillCount,
        formatter: (value: number) => t("dashboard.billCount", { count: Math.round(value) }),
        note: largestBill
          ? t("dashboard.largestBill", { amount: formatCurrency(largestBill.total_amount) })
          : t("dashboard.noBillsIn", { reference: analyticsReferenceLabel }),
        noteIcon: largestBill ? "arrow-top-right" : "receipt-text-remove-outline",
        icon: "receipt-text-outline",
        accent: palette.analytics,
        accentSoft: palette.analyticsSoft,
        sparklineLabel: t("dashboard.branchVolume"),
        sparklineValues: metricSparklineValues.bills,
      },
      {
        key: "cash",
        label: t("dashboard.cashCollection"),
        value: totalCash.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.collectionShare", { percentage: cashShare.toFixed(0) }),
        noteIcon: "percent-outline",
        icon: "wallet-outline",
        accent: palette.success,
        accentSoft: palette.successSoft,
        sparklineLabel: t("dashboard.cashShare"),
        sparklineValues: metricSparklineValues.cash,
      },
      {
        key: "upi",
        label: t("dashboard.upiCollection"),
        value: totalUpi.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.digitalMix", { percentage: Math.max(0, 100 - cashShare).toFixed(0) }),
        noteIcon: "qrcode-scan",
        icon: "qrcode-scan",
        accent: palette.upi,
        accentSoft: palette.upiSoft,
        sparklineLabel: t("dashboard.digitalSpread"),
        sparklineValues: metricSparklineValues.upi,
      },
      {
        key: "remaining-cash",
        label: t("dashboard.remainingCash"),
        value: remainingCash.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.cashCollectedExpenses"),
        noteIcon: "cash-minus",
        icon: "wallet-plus-outline",
        accent: palette.success,
        accentSoft: palette.successSoft,
        sparklineLabel: t("dashboard.netCash"),
        sparklineValues: [remainingCash.toNumber()],
      },
      {
        key: "remaining-upi",
        label: t("dashboard.remainingUpi"),
        value: remainingUpi.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.upiCollectedExpenses"),
        noteIcon: "qrcode-minus",
        icon: "qrcode",
        accent: palette.upi,
        accentSoft: palette.upiSoft,
        sparklineLabel: t("dashboard.netUpi"),
        sparklineValues: [remainingUpi.toNumber()],
      },
      {
        key: "remaining-balance",
        label: t("dashboard.totalRemainingBalance"),
        value: totalRemainingBalance.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.paidExpensesPurchase"),
        noteIcon: "scale-balance",
        icon: "scale-balance",
        accent: palette.analytics,
        accentSoft: palette.analyticsSoft,
        sparklineLabel: t("dashboard.netBalance"),
        sparklineValues: [totalRemainingBalance.toNumber()],
      },
      {
        key: "outstanding-due",
        label: t("dashboard.totalOutstandingDue"),
        value: totalOutstandingDue.toNumber(),
        formatter: (value: number) => formatCurrency(value),
        note: t("dashboard.currentRetailerOutstanding"),
        noteIcon: "account-cash-outline",
        icon: "account-cash-outline",
        accent: palette.billing,
        accentSoft: palette.billingSoft,
        sparklineLabel: t("dashboard.outstanding"),
        sparklineValues: [totalOutstandingDue.toNumber()],
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
      palette.success,
      palette.successSoft,
      palette.billing,
      palette.billingSoft,
      palette.analytics,
      palette.analyticsSoft,
      palette.upi,
      palette.upiSoft,
      totalCash,
      totalExpenseCash,
      totalExpenseUpi,
      totalOutstandingDue,
      totalRevenue,
      totalUpi,
      remainingCash,
      remainingUpi,
      totalRemainingBalance,
      t,
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
