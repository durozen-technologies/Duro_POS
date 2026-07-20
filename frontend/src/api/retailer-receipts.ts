import { buildReceiptHtmlMarkup } from "@/api/receipts";
import { getLocalizedItemName } from "@/hooks/use-shop-translation";
import type { ShopLanguage } from "@/store/shop-language-store";
import {
  RetailerReceiptType,
  RetailerSaleStatus,
  type RetailerBulkSettleRead,
  type RetailerPaymentRead,
  type RetailerSaleRead,
  type RetailerSaleReceiptRead,
  type UUID,
} from "@/types/api";
import { formatCurrency, formatDateTime, formatUnit } from "@/utils/format";
import {
  buildRetailerReceiptPartyText,
  formatRetailerSaleNoDisplay,
  pickRetailerShareReceipt,
  retailerReceiptPartyLabels,
} from "@/utils/retailer-sale";

export const RETAILER_RECEIPT_PROVIDER = "Durozen Technologies pvt. Ltd.";

function formatReceiptCurrency(value?: string | number | null) {
  return formatCurrency(value).replace(/^Rs\.\s*/, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "'");
}

function findPayment(sale: RetailerSaleRead, paymentId: UUID): RetailerPaymentRead | undefined {
  return sale.payments.find((payment) => payment.id === paymentId);
}

function balanceAfterPayment(sale: RetailerSaleRead, payment: RetailerPaymentRead): string {
  const paidThrough = sale.payments
    .filter((row) => new Date(row.paid_at).getTime() <= new Date(payment.paid_at).getTime())
    .reduce((sum, row) => sum + Number(row.total_paid), 0);
  return Math.max(0, Number(sale.total_amount) - paidThrough).toFixed(2);
}

function openingBalanceForReceipt(receipt: RetailerSaleReceiptRead): string {
  return Number(receipt.opening_balance ?? 0).toFixed(2);
}

function totalBalanceAmount(openingBalance: string, currentBillBalance: string): string {
  return (Number(openingBalance) + Number(currentBillBalance)).toFixed(2);
}

function retailerBalanceSummary(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  payment: RetailerPaymentRead,
) {
  const openingBalance = openingBalanceForReceipt(receipt);
  const currentBillBalance = balanceAfterPayment(sale, payment);
  return {
    openingBalance,
    currentBillBalance,
    totalBalance: totalBalanceAmount(openingBalance, currentBillBalance),
  };
}

function aggregateRetailerPaymentTotals(sale: RetailerSaleRead): RetailerPaymentRead {
  const totals = sale.payments.reduce(
    (acc, payment) => ({
      cash_amount: acc.cash_amount + Number(payment.cash_amount),
      upi_amount: acc.upi_amount + Number(payment.upi_amount),
      wallet_amount: acc.wallet_amount + Number(payment.wallet_amount ?? 0),
      total_paid: acc.total_paid + Number(payment.total_paid),
    }),
    { cash_amount: 0, upi_amount: 0, wallet_amount: 0, total_paid: 0 },
  );

  const anchor = sale.payments.at(-1) ?? sale.payments[0];
  if (!anchor) {
    throw new Error("Payment for receipt not found");
  }

  return {
    ...anchor,
    cash_amount: totals.cash_amount.toFixed(2),
    upi_amount: totals.upi_amount.toFixed(2),
    wallet_amount: totals.wallet_amount.toFixed(2),
    total_paid: totals.total_paid.toFixed(2),
  };
}

type RetailerSaleInvoiceBuildOptions = {
  useCurrentSaleBalances?: boolean;
  retailerOutstandingBalance?: string;
};

function shareBalanceSummary(
  sale: RetailerSaleRead,
  retailerOutstandingBalance: string,
) {
  const outstanding = Math.max(0, Number(retailerOutstandingBalance));
  const billDue =
    sale.status === RetailerSaleStatus.SETTLED
      ? 0
      : Math.max(0, Number(sale.balance_due));
  const openingBalance = Math.max(0, outstanding - billDue).toFixed(2);
  const currentBillBalance = billDue.toFixed(2);
  const totalBalance = outstanding.toFixed(2);
  return {
    openingBalance,
    currentBillBalance,
    totalBalance,
    settled: billDue <= 0,
  };
}

function receiptLabels() {
  return {
    saleInvoice: "Sale Invoice",
    paymentReceipt: "Payment Receipt",
    ...retailerReceiptPartyLabels(),
    saleNo: "Sale No",
    saleDate: "Sale Date",
    receiptNo: "Receipt",
    date: "Date",
    item: "Item",
    quantityUnit: "Qty/Unit",
    lineTotal: "Total",
    cash: "Cash",
    upi: "UPI",
    wallet: "Wallet",
    grandTotal: "Grand Total",
    paidAmount: "Paid Amount",
    balanceAmount: "Balance Amount",
    openingBalance: "Opening Balance",
    closingBalance: "Closing Balance",
    paidThisVisit: "Paid This Visit",
    paymentSettled: "Payment Settled",
    thankYou: "Thank you. Visit again.",
    poweredBy: "Software provided by",
    provider: RETAILER_RECEIPT_PROVIDER,
  };
}

function receiptItemName(
  item: RetailerSaleRead["items"][number],
  language?: ShopLanguage,
) {
  return getLocalizedItemName(language === "ta" ? "ta" : "en", item.item_name, item.item_tamil_name);
}

function formatReceiptHeaderName(name: string) {
  return name.toUpperCase();
}

function organizationName(sale: RetailerSaleRead) {
  return sale.organization_name.split("\n")[0]?.trim() || sale.organization_name;
}

function retailerPurchaserHtml(sale: RetailerSaleRead, labels: ReturnType<typeof receiptLabels>) {
  const party = buildRetailerReceiptPartyText(sale.retailer_name, sale.shop_name, labels);
  return `
        <span class="bill-meta-purchaser"><strong>${labels.purchaser}:</strong> ${escapeHtml(sale.retailer_name)}</span>
        <span class="bill-meta-shop"><strong>${labels.shopName}:</strong> ${escapeHtml(sale.shop_name)}</span>`;
}

function retailerBillMetaHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  labels: ReturnType<typeof receiptLabels>,
  openingBalance: string,
) {
  return `
      <div class="bill-meta">
        ${retailerPurchaserHtml(sale, labels)}
        <span><strong>${labels.receiptNo}:</strong> ${escapeHtml(receipt.receipt_number)}</span>
        <span class="bill-meta-primary"><strong>${labels.date}:</strong> ${escapeHtml(formatDateTime(receipt.printed_at))}</span>
        <div class="balance-divider"></div>
        <span class="bill-meta-primary opening-balance-row"><strong>${labels.openingBalance}:</strong> Rs. ${formatReceiptCurrency(openingBalance)}</span>
        <div class="balance-divider"></div>
        <span><strong>${labels.saleNo}:</strong> ${escapeHtml(sale.sale_no)}</span>
        <span><strong>${labels.saleDate}:</strong> ${escapeHtml(formatDateTime(sale.created_at))}</span>
      </div>`;
}

function settledFooter(settled: boolean, labels: ReturnType<typeof receiptLabels>) {
  if (!settled) {
    return `<div class="strong thank-you">${escapeHtml(labels.thankYou)}</div>`;
  }
  return `
    <div class="strong grand-total" style="font-size: 22px; margin-bottom: 8px;">${escapeHtml(labels.paymentSettled)}</div>
    <div class="strong thank-you">${escapeHtml(labels.thankYou)}</div>`;
}

function organizationHeader(sale: RetailerSaleRead) {
  const org = formatReceiptHeaderName(organizationName(sale));
  return `
    <div class="center">
      <div class="strong header-main header-main-divider">${escapeHtml(org)}</div>
    </div>`;
}

function organizationHeaderFromName(organizationNameValue: string) {
  const org = formatReceiptHeaderName(
    organizationNameValue.split("\n")[0]?.trim() || organizationNameValue,
  );
  return `
    <div class="center">
      <div class="strong header-main header-main-divider">${escapeHtml(org)}</div>
    </div>`;
}

function retailerReceiptPartyExportFields(
  retailerName: string,
  shopName: string,
  labels: ReturnType<typeof receiptLabels>,
) {
  const party = buildRetailerReceiptPartyText(retailerName, shopName, labels);
  return {
    purchaserText: party.purchaserLine,
    shopNameMetaText: party.shopLine,
    shopName: "",
  };
}

function receiptFooter(settled: boolean, labels: ReturnType<typeof receiptLabels>) {
  return `
    <div class="total-divider"></div>
    <div class="center footer">
      ${settledFooter(settled, labels)}
      <div class="footer-note">${escapeHtml(labels.poweredBy)}</div>
      <div class="strong thank-you">${escapeHtml(labels.provider)}</div>
    </div>`;
}

type PaymentSummaryExportOptions = {
  includeOpeningBalance?: boolean;
  includeBalanceAmount?: boolean;
  includePaidAmount?: boolean;
  paidAmountFontSize?: number;
};

function paymentSummaryExportFields(
  labels: ReturnType<typeof receiptLabels>,
  paidAmountLabel: string,
  paidAmount: string,
  balanceAmount: string,
  openingBalance: string,
  closingBalance: string,
  options?: PaymentSummaryExportOptions,
) {
  const includeOpeningBalance = options?.includeOpeningBalance ?? true;
  const includeBalanceAmount = options?.includeBalanceAmount ?? true;
  const includePaidAmount = options?.includePaidAmount ?? true;

  return {
    ...(includeOpeningBalance
      ? {
          openingBalanceLabel: labels.openingBalance,
          openingBalanceValue: `Rs. ${formatReceiptCurrency(openingBalance)}`,
        }
      : {}),
    ...(includePaidAmount
      ? {
          paidAmountLabel,
          paidAmountValue: `Rs. ${formatReceiptCurrency(paidAmount)}`,
          ...(options?.paidAmountFontSize ? { paidAmountFontSize: options.paidAmountFontSize } : {}),
        }
      : {}),
    ...(includeBalanceAmount
      ? {
          balanceAmountLabel: labels.balanceAmount,
          balanceAmountValue: `Rs. ${formatReceiptCurrency(balanceAmount)}`,
        }
      : {}),
    totalBalanceLabel: labels.closingBalance,
    totalBalanceValue: `Rs. ${formatReceiptCurrency(closingBalance)}`,
  };
}

function saleItemRowsHtml(sale: RetailerSaleRead, language?: ShopLanguage) {
  return sale.items
    .map(
      (item) => `
        <tr class="item-row">
          <td class="item-name strong">${escapeHtml(receiptItemName(item, language))}</td>
          <td class="align-right item-qty">${escapeHtml(String(item.quantity))}&nbsp;${escapeHtml(formatUnit(item.unit))}</td>
          <td class="align-right item-total strong">${formatReceiptCurrency(item.line_total)}</td>
        </tr>`,
    )
    .join("");
}

function saleItemsExport(sale: RetailerSaleRead, language?: ShopLanguage) {
  return sale.items.map((item) => ({
    itemName: receiptItemName(item, language),
    quantityText: `${item.quantity} ${formatUnit(item.unit)}`,
    lineTotal: formatReceiptCurrency(item.line_total),
  }));
}

function saleItemsTableHtml(labels: ReturnType<typeof receiptLabels>, itemRows: string) {
  return `
      <table>
        <colgroup>
          <col class="col-item-name" />
          <col class="col-item-qty" />
          <col class="col-item-total" />
        </colgroup>
        <thead>
          <tr class="items-header">
            <th align="left">${labels.item}</th>
            <th align="right">${labels.quantityUnit}</th>
            <th align="right">${labels.lineTotal}</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`;
}

function itemExportHeaders(labels: ReturnType<typeof receiptLabels>) {
  return {
    itemHeader: labels.item,
    quantityHeader: labels.quantityUnit,
    totalHeader: labels.lineTotal,
  };
}

function retailerTotalsTableHtml(
  labels: ReturnType<typeof receiptLabels>,
  payment: RetailerPaymentRead,
  sale: RetailerSaleRead,
  paidAmountLabel: string,
  paidAmount: string,
  balanceAmount: string,
  totalBalance: string,
) {
  return `
      <table class="totals-section">
        <colgroup>
          <col class="col-total-label" />
          <col class="col-total-value" />
        </colgroup>
        <tr class="total-row">
          <td>${labels.cash}</td>
          <td class="align-right">${formatReceiptCurrency(payment.cash_amount)}</td>
        </tr>
        <tr class="total-row">
          <td>${labels.upi}</td>
          <td class="align-right">${formatReceiptCurrency(payment.upi_amount)}</td>
        </tr>
        <tr class="total-row">
          <td class="upi-bottom-divider">${labels.wallet}</td>
          <td class="align-right upi-bottom-divider">${formatReceiptCurrency(payment.wallet_amount ?? "0")}</td>
        </tr>
        <tr class="total-row grand-total">
          <td class="strong upi-bottom-divider">${labels.grandTotal}</td>
          <td class="align-right strong upi-bottom-divider">Rs. ${formatReceiptCurrency(sale.total_amount)}</td>
        </tr>
        <tr class="total-row">
          <td class="strong">${paidAmountLabel}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(paidAmount)}</td>
        </tr>
        <tr class="total-row">
          <td class="strong">${labels.balanceAmount}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(balanceAmount)}</td>
        </tr>
        <tr class="total-row total-balance-divider">
          <td colspan="2"></td>
        </tr>
        <tr class="total-row grand-total">
          <td class="strong">${labels.closingBalance}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(totalBalance)}</td>
        </tr>
      </table>`;
}

export function buildRetailerSaleInvoiceHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
  options?: RetailerSaleInvoiceBuildOptions,
) {
  const labels = receiptLabels();
  const payment =
    findPayment(sale, receipt.retailer_payment_id) ?? sale.payments.at(-1) ?? sale.payments[0];
  if (!payment) {
    throw new Error("Payment for receipt not found");
  }

  let paidAmount: string;
  let openingBalance: string;
  let currentBillBalance: string;
  let totalBalance: string;
  let settled: boolean;
  let displayPayment: RetailerPaymentRead;

  if (options?.useCurrentSaleBalances) {
    paidAmount = Number(sale.amount_paid_total).toFixed(2);
    displayPayment = aggregateRetailerPaymentTotals(sale);

    if (options.retailerOutstandingBalance !== undefined) {
      const summary = shareBalanceSummary(sale, options.retailerOutstandingBalance);
      openingBalance = summary.openingBalance;
      currentBillBalance = summary.currentBillBalance;
      totalBalance = summary.totalBalance;
      settled = summary.settled;
    } else {
      openingBalance = openingBalanceForReceipt(receipt);
      currentBillBalance = Number(sale.balance_due).toFixed(2);
      totalBalance = totalBalanceAmount(openingBalance, currentBillBalance);
      settled = Number(sale.balance_due) <= 0;
    }
  } else {
    paidAmount = payment.total_paid;
    const balances = retailerBalanceSummary(sale, receipt, payment);
    openingBalance = balances.openingBalance;
    currentBillBalance = balances.currentBillBalance;
    totalBalance = balances.totalBalance;
    settled = Number(currentBillBalance) <= 0;
    displayPayment = payment;
  }
  const itemRows = saleItemRowsHtml(sale, language);

  const orgName = organizationName(sale);
  const partyFields = retailerReceiptPartyExportFields(sale.retailer_name, sale.shop_name, labels);
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName),
    ...partyFields,
    billText: `${labels.saleNo}: ${sale.sale_no}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(displayPayment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(displayPayment.upi_amount),
    walletLabel: labels.wallet,
    walletValue: formatReceiptCurrency(displayPayment.wallet_amount ?? "0"),
    totalLabel: labels.grandTotal,
    totalValue: `Rs. ${formatReceiptCurrency(sale.total_amount)}`,
    ...paymentSummaryExportFields(
      labels,
      labels.paidAmount,
      paidAmount,
      currentBillBalance,
      openingBalance,
      totalBalance,
    ),
    thankYou: settled ? labels.paymentSettled : labels.thankYou,
    poweredBy: labels.poweredBy,
    provider: labels.provider,
    items: saleItemsExport(sale, language),
  };

  const body = `
    <div class="receipt-container">
      ${organizationHeader(sale)}
      ${retailerBillMetaHtml(sale, receipt, labels, openingBalance)}
      ${saleItemsTableHtml(labels, itemRows)}
      <div class="payment-divider"></div>
      ${retailerTotalsTableHtml(
        labels,
        displayPayment,
        sale,
        labels.paidAmount,
        paidAmount,
        currentBillBalance,
        totalBalance,
      )}
      ${receiptFooter(settled, labels)}
    </div>`;

  return buildReceiptHtmlMarkup(body, exportPayload);
}

export function buildRetailerBalancePaymentHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
) {
  const labels = receiptLabels();
  const payment = findPayment(sale, receipt.retailer_payment_id);
  if (!payment) {
    throw new Error("Payment for receipt not found");
  }
  const balances = retailerBalanceSummary(sale, receipt, payment);
  const { openingBalance, currentBillBalance, totalBalance } = balances;
  const settled = Number(currentBillBalance) <= 0;
  const itemRows = saleItemRowsHtml(sale, language);

  const orgName = organizationName(sale);
  const partyFields = retailerReceiptPartyExportFields(sale.retailer_name, sale.shop_name, labels);
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName),
    ...partyFields,
    billText: `${labels.receiptNo}: ${receipt.receipt_number}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(payment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(payment.upi_amount),
    walletLabel: labels.wallet,
    walletValue: formatReceiptCurrency(payment.wallet_amount ?? "0"),
    totalLabel: labels.grandTotal,
    totalValue: `Rs. ${formatReceiptCurrency(sale.total_amount)}`,
    ...paymentSummaryExportFields(
      labels,
      labels.paidThisVisit,
      payment.total_paid,
      currentBillBalance,
      openingBalance,
      totalBalance,
    ),
    thankYou: settled ? labels.paymentSettled : labels.thankYou,
    poweredBy: labels.poweredBy,
    provider: labels.provider,
    items: saleItemsExport(sale, language),
  };

  const body = `
    <div class="receipt-container">
      ${organizationHeader(sale)}
      <div class="center" style="margin-bottom: 8px;">
        <div class="strong" style="font-size: 18px;">${escapeHtml(labels.paymentReceipt)}</div>
      </div>
      ${retailerBillMetaHtml(sale, receipt, labels, openingBalance)}
      ${saleItemsTableHtml(labels, itemRows)}
      <div class="payment-divider"></div>
      ${retailerTotalsTableHtml(
        labels,
        payment,
        sale,
        labels.paidThisVisit,
        payment.total_paid,
        currentBillBalance,
        totalBalance,
      )}
      ${receiptFooter(settled, labels)}
    </div>`;

  return buildReceiptHtmlMarkup(body, exportPayload);
}

export type RetailerBulkSettleReceiptContext = {
  organizationName: string;
  shopName: string;
};

function bulkSettleAllocationRows(result: RetailerBulkSettleRead) {
  const rows: Array<{ itemName: string; quantityText: string; lineTotal: string }> = [];

  if (Number(result.applied_to_opening) > 0) {
    rows.push({
      itemName: "Opening Balance",
      quantityText: formatReceiptCurrency(result.applied_to_opening),
      lineTotal: formatReceiptCurrency(result.opening_balance_after),
    });
  }

  for (const sale of result.sales) {
    rows.push({
      itemName: formatRetailerSaleNoDisplay(sale.sale_no),
      quantityText: formatReceiptCurrency(sale.amount_applied),
      lineTotal: formatReceiptCurrency(sale.balance_due_after),
    });
  }

  return rows;
}

function bulkSettleAllocationsTableHtml(
  rows: Array<{ itemName: string; quantityText: string; lineTotal: string }>,
) {
  if (rows.length === 0) {
    return "";
  }

  const itemRows = rows
    .map(
      (row) => `
        <tr class="item-row">
          <td class="item-name strong">${escapeHtml(row.itemName)}</td>
          <td class="align-right item-qty">${escapeHtml(row.quantityText)}</td>
          <td class="align-right item-total strong">${escapeHtml(row.lineTotal)}</td>
        </tr>`,
    )
    .join("");

  return `
      <table>
        <colgroup>
          <col class="col-item-name" />
          <col class="col-item-qty" />
          <col class="col-item-total" />
        </colgroup>
        <thead>
          <tr class="items-header">
            <th align="left">Bill</th>
            <th align="right">Applied</th>
            <th align="right">Balance</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`;
}

function bulkSettleTotalsTableHtml(
  labels: ReturnType<typeof receiptLabels>,
  result: RetailerBulkSettleRead,
) {
  return `
      <table class="totals-section">
        <colgroup>
          <col class="col-total-label" />
          <col class="col-total-value" />
        </colgroup>
        <tr class="total-row">
          <td>${labels.cash}</td>
          <td class="align-right">${formatReceiptCurrency(result.cash_amount)}</td>
        </tr>
        <tr class="total-row">
          <td>${labels.upi}</td>
          <td class="align-right">${formatReceiptCurrency(result.upi_amount)}</td>
        </tr>
        <tr class="total-row paid-this-visit-row">
          <td class="strong">${labels.paidThisVisit}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(result.total_paid)}</td>
        </tr>
        <tr class="total-row">
          <td>Applied to Opening</td>
          <td class="align-right">${formatReceiptCurrency(result.applied_to_opening)}</td>
        </tr>
        <tr class="total-row">
          <td>Applied to Bills</td>
          <td class="align-right">${formatReceiptCurrency(result.applied_to_bills)}</td>
        </tr>
        <tr class="total-row total-balance-divider">
          <td colspan="2"></td>
        </tr>
        <tr class="total-row grand-total">
          <td class="strong">${labels.closingBalance}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(result.outstanding_after)}</td>
        </tr>
      </table>`;
}

export function buildRetailerBulkSettleReceiptHtml(
  result: RetailerBulkSettleRead,
  context: RetailerBulkSettleReceiptContext,
) {
  const labels = receiptLabels();
  const settled = Number(result.outstanding_after) <= 0;
  const printedAt = new Date().toISOString();
  const orgName = formatReceiptHeaderName(
    context.organizationName.split("\n")[0]?.trim() || context.organizationName,
  );
  const partyFields = retailerReceiptPartyExportFields(result.retailer_name, context.shopName, labels);
  const allocationRows = bulkSettleAllocationRows(result);

  const exportPayload = {
    companyName: orgName,
    ...partyFields,
    billText: "Outstanding Payment",
    dateText: `${labels.date}: ${formatDateTime(printedAt)}`,
    itemHeader: "Bill",
    quantityHeader: "Applied",
    totalHeader: "Balance",
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(result.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(result.upi_amount),
    totalLabel: labels.paidThisVisit,
    totalValue: `Rs. ${formatReceiptCurrency(result.total_paid)}`,
    totalFontSize: 15,
    ...paymentSummaryExportFields(
      labels,
      labels.paidThisVisit,
      result.total_paid,
      "",
      "",
      result.outstanding_after,
      {
        includeOpeningBalance: false,
        includeBalanceAmount: false,
        includePaidAmount: false,
      },
    ),
    thankYou: settled ? labels.paymentSettled : labels.thankYou,
    poweredBy: labels.poweredBy,
    provider: labels.provider,
    items: allocationRows,
  };

  const body = `
    <div class="receipt-container">
      ${organizationHeaderFromName(context.organizationName)}
      <div class="center" style="margin-bottom: 8px;">
        <div class="strong" style="font-size: 18px;">Outstanding Payment</div>
      </div>
      <div class="bill-meta">
        <span class="bill-meta-purchaser"><strong>${labels.purchaser}:</strong> ${escapeHtml(result.retailer_name)}</span>
        <span class="bill-meta-shop"><strong>${labels.shopName}:</strong> ${escapeHtml(context.shopName)}</span>
        <span class="bill-meta-primary"><strong>${labels.date}:</strong> ${escapeHtml(formatDateTime(printedAt))}</span>
      </div>
      ${bulkSettleAllocationsTableHtml(allocationRows)}
      <div class="payment-divider"></div>
      ${bulkSettleTotalsTableHtml(labels, result)}
      ${receiptFooter(settled, labels)}
    </div>`;

  return buildReceiptHtmlMarkup(body, exportPayload);
}

export function buildRetailerReceiptHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
) {
  if (receipt.receipt_type === RetailerReceiptType.BALANCE_PAYMENT) {
    return buildRetailerBalancePaymentHtml(sale, receipt, language);
  }
  return buildRetailerSaleInvoiceHtml(sale, receipt, language);
}

export function buildRetailerShareReceiptHtml(
  sale: RetailerSaleRead,
  retailerOutstandingBalance: string,
  language?: ShopLanguage,
) {
  const receipt = pickRetailerShareReceipt(sale);
  if (!receipt) {
    throw new Error("No receipt available for this sale");
  }
  return buildRetailerSaleInvoiceHtml(sale, receipt, language, {
    useCurrentSaleBalances: true,
    retailerOutstandingBalance,
  });
}
