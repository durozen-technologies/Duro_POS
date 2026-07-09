import type { RetailerSaleRead } from "@/types/api";
import { formatDateValueInTimeZone } from "@/utils/format";

export type RetailerSalesDateMode = "all" | "single" | "range";

export type RetailerSalesFilterDraft = {
  retailerId: string | null;
  dateMode: RetailerSalesDateMode;
  date: string;
  startDate: string;
  endDate: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createRetailerSalesFilterDraft(now = new Date()): RetailerSalesFilterDraft {
  const today = formatDateValueInTimeZone(now);
  return {
    retailerId: null,
    dateMode: "all",
    date: today,
    startDate: today,
    endDate: today,
  };
}

export function saleCreatedOnDate(sale: RetailerSaleRead): string {
  return formatDateValueInTimeZone(new Date(sale.created_at));
}

export function saleMatchesDateFilter(sale: RetailerSaleRead, filter: RetailerSalesFilterDraft): boolean {
  if (filter.dateMode === "all") {
    return true;
  }

  const saleDate = saleCreatedOnDate(sale);
  if (filter.dateMode === "single") {
    return ISO_DATE_PATTERN.test(filter.date) ? saleDate === filter.date : true;
  }

  const { startDate, endDate } = filter;
  if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(endDate) || endDate < startDate) {
    return true;
  }
  return saleDate >= startDate && saleDate <= endDate;
}

export function saleMatchesSearchQuery(sale: RetailerSaleRead, searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return sale.retailer_name.toLowerCase().includes(query);
}

export function saleMatchesRetailerSalesFilters(
  sale: RetailerSaleRead,
  filter: RetailerSalesFilterDraft,
  searchQuery: string,
): boolean {
  if (filter.retailerId && sale.retailer_id !== filter.retailerId) {
    return false;
  }
  if (!saleMatchesSearchQuery(sale, searchQuery)) {
    return false;
  }
  return saleMatchesDateFilter(sale, filter);
}

export function hasActiveRetailerSalesFilters(filter: RetailerSalesFilterDraft): boolean {
  return filter.retailerId !== null || filter.dateMode !== "all";
}

export function describeRetailerSalesFilter(
  filter: RetailerSalesFilterDraft,
  retailerName?: string | null,
): string {
  const parts: string[] = [];
  if (filter.retailerId) {
    parts.push(retailerName?.trim() || "Retailer");
  }
  if (filter.dateMode === "single" && ISO_DATE_PATTERN.test(filter.date)) {
    parts.push(filter.date);
  } else if (
    filter.dateMode === "range"
    && ISO_DATE_PATTERN.test(filter.startDate)
    && ISO_DATE_PATTERN.test(filter.endDate)
  ) {
    parts.push(
      filter.startDate === filter.endDate
        ? filter.startDate
        : `${filter.startDate} – ${filter.endDate}`,
    );
  }
  return parts.join(" · ");
}

if (process.env.RETAILER_SALES_FILTERS_SELF_CHECK === "1") {
  const today = "2026-07-09";
  const sale = {
    retailer_id: "r1",
    retailer_name: "Alpha Traders",
    created_at: "2026-07-09T10:30:00.000Z",
  } as RetailerSaleRead;

  const base = createRetailerSalesFilterDraft(new Date("2026-07-09T12:00:00+05:30"));
  console.assert(saleMatchesRetailerSalesFilters(sale, base, "") === true, "default filter");
  console.assert(saleMatchesRetailerSalesFilters(sale, { ...base, retailerId: "r2" }, "") === false, "retailer id");
  console.assert(saleMatchesRetailerSalesFilters(sale, base, "alpha") === true, "search");
  console.assert(
    saleMatchesRetailerSalesFilters(sale, { ...base, dateMode: "single", date: today }, "") === true,
    "single date",
  );
  console.assert(
    saleMatchesRetailerSalesFilters(sale, { ...base, dateMode: "single", date: "2026-07-08" }, "") === false,
    "single date miss",
  );
}
