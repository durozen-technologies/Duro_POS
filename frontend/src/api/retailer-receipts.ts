import { buildReceiptHtmlMarkup } from "@/api/receipts";
import { getLocalizedItemName } from "@/hooks/use-shop-translation";
import type { ShopLanguage } from "@/store/shop-language-store";
import {
  RetailerReceiptType,
  type RetailerPaymentRead,
  type RetailerSaleRead,
  type RetailerSaleReceiptRead,
  type UUID,
} from "@/types/api";
import { formatCurrency, formatDateTime, formatUnit } from "@/utils/format";

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

function receiptLabels() {
  return {
    saleInvoice: "Sale Invoice",
    paymentReceipt: "Payment Receipt",
    purchaser: "Purchaser",
    saleNo: "Sale No",
    saleDate: "Sale Date",
    receiptNo: "Receipt",
    date: "Date",
    item: "Item",
    quantityUnit: "Qty/Unit",
    lineTotal: "Total",
    cash: "Cash",
    upi: "UPI",
    grandTotal: "Grand Total",
    paidAmount: "Paid Amount",
    balanceAmount: "Balance Amount",
    openingBalance: "Opening Balance",
    totalBalance: "Total Balance",
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

function retailerPurchaserHtml(retailerName: string, labels: ReturnType<typeof receiptLabels>) {
  return `<span class="bill-meta-purchaser"><strong>${labels.purchaser}:</strong> ${escapeHtml(retailerName)}</span>`;
}

function retailerBillMetaHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  labels: ReturnType<typeof receiptLabels>,
  openingBalance: string,
) {
  return `
      <div class="bill-meta">
        ${retailerPurchaserHtml(sale.retailer_name, labels)}
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
  const shop = formatReceiptHeaderName(sale.shop_name);
  return `
    <div class="center">
      <div class="strong header-main">${escapeHtml(org)}</div>
      <div class="strong header-sub">${escapeHtml(shop)}</div>
    </div>`;
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

function paymentSummaryExportFields(
  labels: ReturnType<typeof receiptLabels>,
  paidAmountLabel: string,
  paidAmount: string,
  balanceAmount: string,
  openingBalance: string,
  totalBalance: string,
) {
  return {
    paidAmountLabel,
    paidAmountValue: `Rs. ${formatReceiptCurrency(paidAmount)}`,
    balanceAmountLabel: labels.balanceAmount,
    balanceAmountValue: `Rs. ${formatReceiptCurrency(balanceAmount)}`,
    openingBalanceLabel: labels.openingBalance,
    openingBalanceValue: `Rs. ${formatReceiptCurrency(openingBalance)}`,
    totalBalanceLabel: labels.totalBalance,
    totalBalanceValue: `Rs. ${formatReceiptCurrency(totalBalance)}`,
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
          <td class="upi-bottom-divider">${labels.upi}</td>
          <td class="align-right upi-bottom-divider">${formatReceiptCurrency(payment.upi_amount)}</td>
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
          <td class="strong">${labels.totalBalance}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(totalBalance)}</td>
        </tr>
      </table>`;
}

export function buildRetailerSaleInvoiceHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
) {
  const labels = receiptLabels();
  const payment =
    findPayment(sale, receipt.retailer_payment_id) ?? sale.payments[0];
  if (!payment) {
    throw new Error("Payment for receipt not found");
  }
  const paidAmount = payment.total_paid;
  const balances = retailerBalanceSummary(sale, receipt, payment);
  const { openingBalance, currentBillBalance, totalBalance } = balances;
  const settled = Number(currentBillBalance) <= 0;
  const itemRows = saleItemRowsHtml(sale, language);

  const orgName = organizationName(sale);
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName),
    shopName: formatReceiptHeaderName(sale.shop_name),
    billText: `${labels.saleNo}: ${sale.sale_no}`,
    purchaserText: `${labels.purchaser}: ${sale.retailer_name}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(payment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(payment.upi_amount),
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
        payment,
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
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName),
    shopName: formatReceiptHeaderName(sale.shop_name),
    billText: `${labels.receiptNo}: ${receipt.receipt_number}`,
    purchaserText: `${labels.purchaser}: ${sale.retailer_name}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(payment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(payment.upi_amount),
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
