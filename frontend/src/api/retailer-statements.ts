import type { RetailerRead, RetailerSaleRead } from "@/types/api";
import {
  computeStatementTotals,
  describeStatementDateRange,
  expandSalesToStatementRows,
  type StatementDateScope,
} from "@/utils/retailer-statement";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type BuildRetailerStatementHtmlInput = {
  retailer: RetailerRead;
  sales: RetailerSaleRead[];
  outstandingBalance: string;
  creditBalance?: string | null;
  dateScope: StatementDateScope;
  date: string;
  startDate: string;
  endDate: string;
};

export function buildRetailerStatementHtml(input: BuildRetailerStatementHtmlInput): string {
  const rows = expandSalesToStatementRows(input.sales);
  const totals = computeStatementTotals(input.sales, input.outstandingBalance, input.creditBalance);
  const dateRangeLabel = describeStatementDateRange(
    input.dateScope,
    input.date,
    input.startDate,
    input.endDate,
  );
  const organizationName =
    input.sales.find((sale) => sale.organization_name?.trim())?.organization_name?.trim() ?? "DUROZEN";
  const retailerPhone = input.retailer.phone?.trim() ?? "";
  const retailerAlternatePhone = input.retailer.alternate_phone?.trim() ?? "";
  const retailerShopName = input.retailer.shop_name?.trim() ?? "";
  const retailerAddress = input.retailer.address?.trim() ?? "";

  const tableRowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.billNo)}</td>
          <td>${escapeHtml(row.itemName)}</td>
          <td>${escapeHtml(row.qtyRate)}</td>
          <td class="num">${escapeHtml(row.billValue)}</td>
          <td class="num">${escapeHtml(row.paidAmount)}</td>
          <td class="num">${escapeHtml(row.balanceAmount)}</td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page {
        margin: 18mm 14mm;
      }
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #111111;
        font-family: "Noto Sans Tamil", "Nirmala UI", "Latha", Arial, Helvetica, sans-serif;
      }
      .page {
        width: 100%;
      }
      .org {
        text-align: center;
        font-size: 22px;
        font-weight: 800;
      }
      .title {
        text-align: center;
        font-size: 18px;
        font-weight: 700;
        margin-top: 8px;
      }
      .meta {
        margin-top: 18px;
        font-size: 14px;
        line-height: 1.5;
      }
      .opening {
        margin-top: 12px;
        text-align: right;
        font-size: 14px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
        font-size: 12px;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #111111;
        padding: 6px 8px;
        vertical-align: top;
        word-wrap: break-word;
      }
      th {
        background: #f3f4f6;
        text-align: left;
      }
      td.num, th.num {
        text-align: right;
      }
      .totals {
        margin-top: 18px;
        margin-left: auto;
        width: 320px;
        font-size: 14px;
      }
      .totals div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 6px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="org">${escapeHtml(organizationName)}</div>
      <div class="title">Outstanding Balance Statement</div>
      <div class="meta">
        <div><strong>${escapeHtml(input.retailer.name)}</strong></div>
        ${retailerShopName ? `<div>${escapeHtml(retailerShopName)}</div>` : ""}
        ${retailerPhone ? `<div>Mobile: ${escapeHtml(retailerPhone)}</div>` : ""}
        ${retailerAlternatePhone ? `<div>Alternate Mobile: ${escapeHtml(retailerAlternatePhone)}</div>` : ""}
        ${retailerAddress ? `<div>${escapeHtml(retailerAddress)}</div>` : ""}
        <div>Period: ${escapeHtml(dateRangeLabel)}</div>
      </div>
      <div class="opening">Opening Balance: ${escapeHtml(totals.openingBalance)}</div>
      <table>
        <thead>
          <tr>
            <th style="width: 12%;">Date</th>
            <th style="width: 14%;">Bill Number</th>
            <th style="width: 22%;">Items</th>
            <th style="width: 18%;">Qty × Rate</th>
            <th class="num" style="width: 12%;">Bill Value</th>
            <th class="num" style="width: 12%;">Paid Amount</th>
            <th class="num" style="width: 10%;">Balance Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <div class="totals">
        <div><span>Wallet Balance</span><span>${escapeHtml(totals.walletBalance)}</span></div>
        <div><span>Total Bill Amount</span><span>${escapeHtml(totals.totalBillAmount)}</span></div>
        <div><span>Total Paid Amount</span><span>${escapeHtml(totals.totalPaidAmount)}</span></div>
        <div><span>Total Balance</span><span>${escapeHtml(totals.closingBalance)}</span></div>
      </div>
    </div>
  </body>
</html>`;
}
