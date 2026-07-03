import { RetailerSaleStatus, type RetailerSaleRead } from "@/types/api";

const SALE_NO_PATTERN = /^RS-(\d{4})-(\d{2})-(\d{6})$/i;

export type ParsedRetailerSaleNo = {
  year: number;
  month: number;
  sequence: number;
};

export function parseRetailerSaleNo(saleNo: string): ParsedRetailerSaleNo | null {
  const match = SALE_NO_PATTERN.exec(saleNo.trim());
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    sequence: Number(match[3]),
  };
}

/** Newest sale numbers first (year → month → sequence, descending). */
export function compareRetailerSaleNos(left: string, right: string) {
  const parsedLeft = parseRetailerSaleNo(left);
  const parsedRight = parseRetailerSaleNo(right);
  if (parsedLeft && parsedRight) {
    if (parsedRight.year !== parsedLeft.year) {
      return parsedRight.year - parsedLeft.year;
    }
    if (parsedRight.month !== parsedLeft.month) {
      return parsedRight.month - parsedLeft.month;
    }
    return parsedRight.sequence - parsedLeft.sequence;
  }
  return right.localeCompare(left);
}

export function formatRetailerSaleNoDisplay(saleNo: string) {
  const parsed = parseRetailerSaleNo(saleNo);
  if (!parsed) {
    return saleNo.trim().toUpperCase();
  }
  const month = String(parsed.month).padStart(2, "0");
  const sequence = String(parsed.sequence).padStart(6, "0");
  return `RS-${parsed.year}-${month} · ${sequence}`;
}

export function isPendingRetailerSale(sale: Pick<RetailerSaleRead, "status">) {
  return (
    sale.status === RetailerSaleStatus.OPEN || sale.status === RetailerSaleStatus.PARTIAL
  );
}

export function isSettledRetailerSale(sale: Pick<RetailerSaleRead, "status">) {
  return sale.status === RetailerSaleStatus.SETTLED;
}

export function sortRetailerSalesByNo(sales: RetailerSaleRead[]) {
  return [...sales].sort((left, right) => compareRetailerSaleNos(left.sale_no, right.sale_no));
}
