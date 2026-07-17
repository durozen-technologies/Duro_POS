import type { RetailerSaleLineRead, RetailerSaleRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency, formatDate, formatDateValueInTimeZone, formatUnit } from "@/utils/format";
import { formatRetailerSaleNoDisplay } from "@/utils/retailer-sale";

function getTamilItemName(itemName: string, itemTamilName?: string | null) {
  const tamilName = itemTamilName?.trim();
  return tamilName || itemName;
}

export type StatementDateScope = "all" | "single" | "range";

export type StatementDateDraft = {
  dateMode: StatementDateScope;
  date: string;
  startDate: string;
  endDate: string;
};

export type StatementTotals = {
  openingBalance: string;
  walletBalance: string;
  totalBillAmount: string;
  totalPaidAmount: string;
  closingBalance: string;
  shownBalanceDue: string;
};

export type StatementRow = {
  date: string;
  billNo: string;
  shopName: string;
  itemName: string;
  qtyRate: string;
  billValue: string;
  paidAmount: string;
  balanceAmount: string;
  isContinuation: boolean;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createStatementDateDraft(now = new Date()): StatementDateDraft {
  const today = formatDateValueInTimeZone(now);
  return {
    dateMode: "all",
    date: today,
    startDate: today,
    endDate: today,
  };
}

export function resolveStatementApiDates(
  scope: StatementDateScope,
  date: string,
  startDate: string,
  endDate: string,
): { start_date?: string; end_date?: string } {
  if (scope === "all") {
    return {};
  }
  if (scope === "single" && ISO_DATE_PATTERN.test(date)) {
    return { start_date: date, end_date: date };
  }
  if (
    scope === "range"
    && ISO_DATE_PATTERN.test(startDate)
    && ISO_DATE_PATTERN.test(endDate)
    && endDate >= startDate
  ) {
    return { start_date: startDate, end_date: endDate };
  }
  return {};
}

export function describeStatementDateRange(
  scope: StatementDateScope,
  date: string,
  startDate: string,
  endDate: string,
): string {
  if (scope === "all") {
    return "All Bills";
  }
  if (scope === "single" && ISO_DATE_PATTERN.test(date)) {
    return date;
  }
  if (
    scope === "range"
    && ISO_DATE_PATTERN.test(startDate)
    && ISO_DATE_PATTERN.test(endDate)
  ) {
    return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  }
  return "All Bills";
}

export function isValidStatementDateDraft(draft: StatementDateDraft): boolean {
  if (draft.dateMode === "all") {
    return true;
  }
  if (draft.dateMode === "single") {
    return ISO_DATE_PATTERN.test(draft.date);
  }
  return (
    ISO_DATE_PATTERN.test(draft.startDate)
    && ISO_DATE_PATTERN.test(draft.endDate)
    && draft.endDate >= draft.startDate
  );
}

export function saleHasBalanceDue(sale: Pick<RetailerSaleRead, "balance_due">) {
  return money(sale.balance_due).gt(0);
}

export function filterStatementSales(sales: RetailerSaleRead[]) {
  return sales.filter(saleHasBalanceDue);
}

export function canShareRetailerStatement(
  openSales: readonly Pick<RetailerSaleRead, "balance_due">[],
) {
  return openSales.some(saleHasBalanceDue);
}

export function buildRetailerBalanceStatementFilename(retailerName: string) {
  const safeName =
    retailerName
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f\s]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Retailer";
  return `${safeName}-Balance-Statement.pdf`;
}

function sumMoney(values: string[]): string {
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total.toFixed(2);
}

export function computeStatementTotals(
  sales: RetailerSaleRead[],
  outstandingBalance: string,
  creditBalance?: string | null,
): StatementTotals {
  const shownBalanceDue = sumMoney(sales.map((sale) => sale.balance_due));
  const opening = Math.max(0, Number(outstandingBalance) - Number(shownBalanceDue)).toFixed(2);
  const totalBillAmount = sumMoney(sales.map((sale) => sale.total_amount));
  const totalPaidAmount = sumMoney(sales.map((sale) => sale.amount_paid_total));
  const walletBalance = Number(creditBalance ?? 0).toFixed(2);
  const closingBalance = (
    Number(totalBillAmount) - Number(totalPaidAmount) - Number(walletBalance)
  ).toFixed(2);

  return {
    openingBalance: opening,
    walletBalance,
    totalBillAmount,
    totalPaidAmount,
    closingBalance,
    shownBalanceDue,
  };
}

function formatStatementCurrency(value: string) {
  return formatCurrency(value).replace(/^Rs\.\s*/, "");
}

function formatQtyRate(line: RetailerSaleLineRead): string {
  const qty = `${line.quantity} ${formatUnit(line.unit)}`;
  const rate = formatStatementCurrency(line.price_per_unit);
  return `${qty} × ${rate}`;
}

function buildLineRow(
  sale: RetailerSaleRead,
  line: RetailerSaleLineRead,
  isContinuation: boolean,
): StatementRow {
  return {
    date: isContinuation ? "" : formatDate(sale.created_at),
    billNo: isContinuation ? "" : formatRetailerSaleNoDisplay(sale.sale_no),
    shopName: isContinuation ? "" : sale.shop_name,
    itemName: getTamilItemName(line.item_name, line.item_tamil_name),
    qtyRate: formatQtyRate(line),
    billValue: isContinuation ? "" : formatStatementCurrency(sale.total_amount),
    paidAmount: isContinuation ? "" : formatStatementCurrency(sale.amount_paid_total),
    balanceAmount: isContinuation ? "" : formatStatementCurrency(sale.balance_due),
    isContinuation,
  };
}

export function expandSalesToStatementRows(sales: RetailerSaleRead[]): StatementRow[] {
  const sorted = [...sales].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );

  const rows: StatementRow[] = [];
  for (const sale of sorted) {
    const lines = sale.items.length > 0 ? sale.items : [];
    if (lines.length === 0) {
      rows.push({
        date: formatDate(sale.created_at),
        billNo: formatRetailerSaleNoDisplay(sale.sale_no),
        shopName: sale.shop_name,
        itemName: "—",
        qtyRate: "—",
        billValue: formatStatementCurrency(sale.total_amount),
        paidAmount: formatStatementCurrency(sale.amount_paid_total),
        balanceAmount: formatStatementCurrency(sale.balance_due),
        isContinuation: false,
      });
      continue;
    }

    lines.forEach((line, index) => {
      rows.push(buildLineRow(sale, line, index > 0));
    });
  }

  return rows;
}

if (process.env.RETAILER_STATEMENT_SELF_CHECK === "1") {
  const saleA = {
    sale_no: "RS-2026-07-0001",
    created_at: "2026-07-08T10:00:00.000Z",
    total_amount: "1000.00",
    amount_paid_total: "400.00",
    balance_due: "600.00",
    items: [
      {
        item_name: "Chicken",
        item_tamil_name: "கோழி",
        quantity: "2",
        unit: "kg",
        price_per_unit: "200.00",
        line_total: "400.00",
      },
      {
        item_name: "Mutton",
        item_tamil_name: "ஆட்டு",
        quantity: "1",
        unit: "kg",
        price_per_unit: "600.00",
        line_total: "600.00",
      },
    ],
  } as RetailerSaleRead;

  const saleB = {
    sale_no: "RS-2026-07-0002",
    created_at: "2026-07-09T10:00:00.000Z",
    total_amount: "500.00",
    amount_paid_total: "500.00",
    balance_due: "0.00",
    items: [
      {
        item_name: "Fish",
        item_tamil_name: "மீன்",
        quantity: "1",
        unit: "kg",
        price_per_unit: "500.00",
        line_total: "500.00",
      },
    ],
  } as RetailerSaleRead;

  const totals = computeStatementTotals([saleA], "600.00", "50.00");
  console.assert(totals.openingBalance === "0.00", "opening balance");
  console.assert(totals.walletBalance === "50.00", "wallet balance");
  console.assert(totals.totalBillAmount === "1000.00", "total bill amount");
  console.assert(totals.totalPaidAmount === "400.00", "total paid amount");
  console.assert(totals.closingBalance === "550.00", "closing balance");

  const filtered = filterStatementSales([saleB, saleA]);
  console.assert(filtered.length === 1 && filtered[0] === saleA, "balance due filter");
  console.assert(
    canShareRetailerStatement([{ balance_due: "10.00" }]),
    "share enabled for unpaid bill",
  );
  console.assert(
    !canShareRetailerStatement([]),
    "share disabled when balance is opening balance only",
  );
  console.assert(
    buildRetailerBalanceStatementFilename(' Raja / Chicken:Shop? ') ===
      "Raja-Chicken-Shop-Balance-Statement.pdf",
    "safe retailer statement filename",
  );

  const rows = expandSalesToStatementRows(filtered);
  console.assert(rows.length === 2, "row count");
  console.assert(rows[0].billNo !== "" && rows[1].isContinuation === true, "continuation row");
  console.assert(rows[0].itemName === "கோழி", "tamil item name");

  const apiDates = resolveStatementApiDates("single", "2026-07-09", "", "");
  console.assert(apiDates.start_date === "2026-07-09" && apiDates.end_date === "2026-07-09", "single date api");

  console.log("retailer-statement self-check passed");
}
