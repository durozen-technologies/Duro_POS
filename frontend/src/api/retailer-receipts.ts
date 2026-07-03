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

function receiptLabels(language?: ShopLanguage) {
  const ta = language === "ta";
  return {
    saleInvoice: ta ? "விற்பனை ரசீது" : "Sale Invoice",
    paymentReceipt: ta ? "கட்டண ரசீது" : "Payment Receipt",
    purchaser: ta ? "வாங்குபவர்" : "Purchaser",
    saleNo: ta ? "விற்பனை எண்" : "Sale No",
    saleDate: ta ? "விற்பனை தேதி" : "Sale Date",
    receiptNo: ta ? "ரசீது" : "Receipt",
    date: ta ? "தேதி" : "Date",
    item: ta ? "பொருள்" : "Item",
    quantityUnit: ta ? "அளவு" : "Qty/Unit",
    lineTotal: ta ? "மொத்தம்" : "Total",
    cash: ta ? "பணம்" : "Cash",
    upi: ta ? "யூபிஐ" : "UPI",
    grandTotal: ta ? "மொத்த தொகை" : "Grand Total",
    paidAmount: ta ? "செலுத்திய தொகை" : "Paid Amount",
    balanceAmount: ta ? "நிலுவை தொகை" : "Balance Amount",
    paidThisVisit: ta ? "இப்போது செலுத்தியது" : "Paid This Visit",
    paymentSettled: ta ? "கட்டணம் முழுமை" : "Payment Settled",
    thankYou: ta ? "நன்றி. மீண்டும் வருக." : "Thank you. Visit again.",
    poweredBy: ta ? "மென்பொருள் வழங்கியது" : "Software provided by",
    provider: RETAILER_RECEIPT_PROVIDER,
  };
}

function organizationName(sale: RetailerSaleRead) {
  return sale.organization_name.split("\n")[0]?.trim() || sale.organization_name;
}

function formatReceiptHeaderName(name: string, language?: ShopLanguage) {
  return language === "ta" ? name : name.toUpperCase();
}

function settledFooter(settled: boolean, labels: ReturnType<typeof receiptLabels>) {
  if (!settled) {
    return `<div class="strong thank-you">${escapeHtml(labels.thankYou)}</div>`;
  }
  return `
    <div class="strong grand-total" style="font-size: 22px; margin-bottom: 8px;">${escapeHtml(labels.paymentSettled)}</div>
    <div class="strong thank-you">${escapeHtml(labels.thankYou)}</div>`;
}

function organizationHeader(sale: RetailerSaleRead, language?: ShopLanguage) {
  const org = formatReceiptHeaderName(organizationName(sale), language);
  const shop = formatReceiptHeaderName(sale.shop_name, language);
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
  paidAmount: string,
  balanceAmount: string,
) {
  return {
    paidAmountLabel: labels.paidAmount,
    paidAmountValue: `Rs. ${formatReceiptCurrency(paidAmount)}`,
    balanceAmountLabel: labels.balanceAmount,
    balanceAmountValue: `Rs. ${formatReceiptCurrency(balanceAmount)}`,
  };
}

function saleItemRowsHtml(sale: RetailerSaleRead, language?: ShopLanguage) {
  return sale.items
    .map(
      (item) => `
        <tr class="item-row">
          <td class="item-name strong">${escapeHtml(getLocalizedItemName("ta", item.item_name, item.item_tamil_name))}</td>
          <td class="align-right item-qty">${escapeHtml(String(item.quantity))}&nbsp;${escapeHtml(formatUnit(item.unit))}</td>
          <td class="align-right item-total strong">${formatReceiptCurrency(item.line_total)}</td>
        </tr>`,
    )
    .join("");
}

function saleItemsExport(sale: RetailerSaleRead) {
  return sale.items.map((item) => ({
    itemName: getLocalizedItemName("ta", item.item_name, item.item_tamil_name),
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

export function buildRetailerSaleInvoiceHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
) {
  const labels = receiptLabels(language);
  const payment =
    findPayment(sale, receipt.retailer_payment_id) ?? sale.payments[0];
  if (!payment) {
    throw new Error("Payment for receipt not found");
  }
  const paidAmount = payment.total_paid;
  const balanceAmount = balanceAfterPayment(sale, payment);
  const settled = Number(balanceAmount) <= 0;
  const itemRows = saleItemRowsHtml(sale, language);

  const orgName = organizationName(sale);
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName, language),
    shopName: formatReceiptHeaderName(sale.shop_name, language),
    billText: `${labels.saleNo}: ${sale.sale_no} · ${labels.purchaser}: ${sale.retailer_name}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(payment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(payment.upi_amount),
    totalLabel: labels.grandTotal,
    totalValue: `Rs. ${formatReceiptCurrency(sale.total_amount)}`,
    ...paymentSummaryExportFields(labels, paidAmount, balanceAmount),
    thankYou: settled ? labels.paymentSettled : labels.thankYou,
    poweredBy: labels.poweredBy,
    provider: labels.provider,
    items: saleItemsExport(sale),
  };

  const body = `
    <div class="receipt-container">
      ${organizationHeader(sale, language)}
      <div class="bill-meta">
        <span><strong>${labels.purchaser}:</strong> ${escapeHtml(sale.retailer_name)}</span>
        <span><strong>${labels.receiptNo}:</strong> ${escapeHtml(receipt.receipt_number)}</span>
        <span><strong>${labels.date}:</strong> ${escapeHtml(formatDateTime(receipt.printed_at))}</span>
        <span><strong>${labels.saleNo}:</strong> ${escapeHtml(sale.sale_no)}</span>
        <span><strong>${labels.saleDate}:</strong> ${escapeHtml(formatDateTime(sale.created_at))}</span>
      </div>
      ${saleItemsTableHtml(labels, itemRows)}
      <div class="payment-divider"></div>
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
          <td class="strong">${labels.paidAmount}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(paidAmount)}</td>
        </tr>
        <tr class="total-row">
          <td class="strong">${labels.balanceAmount}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(balanceAmount)}</td>
        </tr>
      </table>
      ${receiptFooter(settled, labels)}
    </div>`;

  return buildReceiptHtmlMarkup(body, exportPayload);
}

export function buildRetailerBalancePaymentHtml(
  sale: RetailerSaleRead,
  receipt: RetailerSaleReceiptRead,
  language?: ShopLanguage,
) {
  const labels = receiptLabels(language);
  const payment = findPayment(sale, receipt.retailer_payment_id);
  if (!payment) {
    throw new Error("Payment for receipt not found");
  }
  const balanceAmount = balanceAfterPayment(sale, payment);
  const settled = Number(balanceAmount) <= 0;
  const itemRows = saleItemRowsHtml(sale, language);

  const orgName = organizationName(sale);
  const exportPayload = {
    companyName: formatReceiptHeaderName(orgName, language),
    shopName: formatReceiptHeaderName(sale.shop_name, language),
    billText: `${labels.receiptNo}: ${receipt.receipt_number} · ${labels.purchaser}: ${sale.retailer_name}`,
    dateText: `${labels.date}: ${formatDateTime(receipt.printed_at)}`,
    ...itemExportHeaders(labels),
    cashLabel: labels.cash,
    cashValue: formatReceiptCurrency(payment.cash_amount),
    upiLabel: labels.upi,
    upiValue: formatReceiptCurrency(payment.upi_amount),
    totalLabel: labels.grandTotal,
    totalValue: `Rs. ${formatReceiptCurrency(sale.total_amount)}`,
    paidAmountLabel: labels.paidThisVisit,
    paidAmountValue: `Rs. ${formatReceiptCurrency(payment.total_paid)}`,
    balanceAmountLabel: labels.balanceAmount,
    balanceAmountValue: `Rs. ${formatReceiptCurrency(balanceAmount)}`,
    thankYou: settled ? labels.paymentSettled : labels.thankYou,
    poweredBy: labels.poweredBy,
    provider: labels.provider,
    items: saleItemsExport(sale),
  };

  const body = `
    <div class="receipt-container">
      ${organizationHeader(sale, language)}
      <div class="center" style="margin-bottom: 8px;">
        <div class="strong" style="font-size: 18px;">${escapeHtml(labels.paymentReceipt)}</div>
      </div>
      <div class="bill-meta">
        <span><strong>${labels.purchaser}:</strong> ${escapeHtml(sale.retailer_name)}</span>
        <span><strong>${labels.receiptNo}:</strong> ${escapeHtml(receipt.receipt_number)}</span>
        <span><strong>${labels.date}:</strong> ${escapeHtml(formatDateTime(receipt.printed_at))}</span>
        <span><strong>${labels.saleNo}:</strong> ${escapeHtml(sale.sale_no)}</span>
        <span><strong>${labels.saleDate}:</strong> ${escapeHtml(formatDateTime(sale.created_at))}</span>
      </div>
      ${saleItemsTableHtml(labels, itemRows)}
      <div class="payment-divider"></div>
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
          <td class="strong">${labels.paidThisVisit}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(payment.total_paid)}</td>
        </tr>
        <tr class="total-row">
          <td class="strong">${labels.balanceAmount}</td>
          <td class="align-right strong">Rs. ${formatReceiptCurrency(balanceAmount)}</td>
        </tr>
      </table>
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
