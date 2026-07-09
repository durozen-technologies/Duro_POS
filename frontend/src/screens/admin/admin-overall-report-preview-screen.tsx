import { MaterialCommunityIcons } from "@expo/vector-icons";
import { requireOptionalNativeModule } from "expo-modules-core";
import { StatusBar } from "expo-status-bar";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  downloadAdminReportPdf,
  fetchAdminOverallReport,
  type FetchOverallReportParams,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError, formatApiErrorMessage } from "@/api/client";
import type { AdminOverallReportPreviewScreenProps } from "@/navigation/types";
import {
  AnalyticsPeriod,
  BaseUnit,
  type OverallReportInventoryItem,
  type OverallReportRead,
  type OverallReportStatement,
  type OverallReportUsedStockBreakdown,
  type OverallReportRetailer,
} from "@/types/api";
import { money, toMoneyString, toQuantityString } from "@/utils/decimal";

import { adminElevation, adminRadii, type ThemePalette, adminSpacing, adminTypography } from "./admin-dashboard-theme";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

type ExpoSharingNativeModule = {
  isAvailableAsync?: () => Promise<boolean>;
  shareAsync?: (
    url: string,
    options?: {
      dialogTitle?: string;
      mimeType?: string;
      UTI?: string;
    },
  ) => Promise<void>;
};

type ReportLanguage = "en" | "ta";

/** Font family name for Tamil script — registered in App.tsx via expo-font */
const TAMIL_FONT = "NotoSansTamil";

/** Constant unit suffix — never translated */
const KG_UNIT_LABEL = "(Kg/Unit)";

type SheetColumn = {
  key: string;
  label: string;
  /** Proper Tamil Unicode label — rendered with NotoSansTamil font */
  tamilLabel: string;
  /** When true, appends {@link KG_UNIT_LABEL} in Latin script after the label */
  kgUnit?: boolean;
  width: number;
  align?: "left" | "center" | "right";
};

type SheetRow = {
  id: string;
  cells: string[];
};

export function buildSheetColumns(_retailers?: OverallReportRetailer[]): SheetColumn[] {
  return [
    { key: "date", label: "Date", tamilLabel: "\u0ba4\u0bc7\u0ba4\u0bbf", width: 92, align: "center" },
    { key: "inventory", label: "Inventory Item", tamilLabel: "\u0b9a\u0bb0\u0b95\u0bcd\u0b95\u0bc1 \u0baa\u0bca\u0bb0\u0bc1\u0bb3\u0bcd", width: 132 },
    { key: "old", label: "Old Stock", tamilLabel: "\u0baa\u0bb4\u0bc8\u0baf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 118, align: "right", kgUnit: true },
    { key: "adding", label: "Added Stock", tamilLabel: "\u0b9a\u0bc7\u0bb0\u0bcd\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 126, align: "right", kgUnit: true },
    { key: "available", label: "Total Available Stock", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0b95\u0bbf\u0b9f\u0bc8\u0b95\u0bcd\u0b95\u0bc1\u0bae\u0bcd \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 136, align: "right", kgUnit: true },
    { key: "used", label: "Used Stock (Normal)", tamilLabel: "\u0baa\u0baf\u0ba9\u0bcd\u0baa\u0b9f\u0bc1\u0ba4\u0bcd\u0ba4\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 138, kgUnit: true },
    { key: "retailer_used", label: "Total Retailer Used Stock", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 148, align: "right", kgUnit: true },
    { key: "transfer", label: "Transfer Stock", tamilLabel: "\u0baa\u0bb0\u0bbf\u0bae\u0bbe\u0bb1\u0bcd\u0bb1 \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 130, align: "right", kgUnit: true },
    { key: "remaining", label: "Remaining Stock", tamilLabel: "\u0bae\u0bc0\u0ba4\u0bbf \u0b87\u0bb0\u0bc1\u0baa\u0bcd\u0baa\u0bc1", width: 126, align: "right", kgUnit: true },
    { key: "purchase_rate", label: "Purchase Rate", tamilLabel: "\u0b95\u0bca\u0bb3\u0bcd\u0bae\u0bc1\u0ba4\u0bb2\u0bcd \u0ba4\u0bca\u0b95\u0bc8", width: 124, align: "right" },
    { key: "purchase_amount", label: "Purchase Amount", tamilLabel: "\u0b95\u0bca\u0bb3\u0bcd\u0bae\u0bc1\u0ba4\u0bb2\u0bcd \u0ba4\u0bca\u0b95\u0bc8", width: 124, align: "right" },
    { key: "billing", label: "Billing Item", tamilLabel: "\u0baa\u0bbf\u0bb2\u0bcd\u0bb2\u0bbf\u0b99\u0bcd \u0baa\u0bca\u0bb0\u0bc1\u0bb3\u0bcd", width: 142 },
    { key: "assumption", label: "Assumption (Normal)", tamilLabel: "\u0b85\u0ba9\u0bc1\u0bae\u0bbe\u0ba9\u0bae\u0bcd", width: 132, align: "right", kgUnit: true },
    { key: "retailer_assumption", label: "Total Retailer Assumption", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0b85\u0ba9\u0bc1\u0bae\u0bbe\u0ba9\u0bae\u0bcd", width: 148, align: "right", kgUnit: true },
    { key: "sales", label: "Sales (Normal)", tamilLabel: "\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8", width: 112, align: "right", kgUnit: true },
    { key: "retailer_sales", label: "Total Retailer Sales", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8", width: 136, align: "right", kgUnit: true },
    { key: "difference", label: "Difference", tamilLabel: "\u0bb5\u0bbf\u0ba4\u0bcd\u0ba4\u0bbf\u0baf\u0bbe\u0b9a\u0bae\u0bcd", width: 120, align: "right", kgUnit: true },
    { key: "assumption_amount", label: "Assumption Amount (Normal)", tamilLabel: "\u0b85\u0ba9\u0bc1\u0bae\u0bbe\u0ba9 \u0ba4\u0bca\u0b95\u0bc8", width: 148, align: "right" },
    { key: "retailer_assumption_amount", label: "Total Retailer Assumption Amount", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0b85\u0ba9\u0bc1\u0bae\u0bbe\u0ba9 \u0ba4\u0bca\u0b95\u0bc8", width: 156, align: "right" },
    { key: "sales_amount", label: "Sales Amount (Normal)", tamilLabel: "\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8 \u0ba4\u0bca\u0b95\u0bc8", width: 132, align: "right" },
    { key: "retailer_sales_amount", label: "Total Retailer Billing Amount", tamilLabel: "\u0bae\u0bca\u0ba4\u0bcd\u0ba4 \u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bcd \u0baa\u0bbf\u0bb2\u0bcd\u0bb2\u0bbf\u0b99\u0bcd \u0ba4\u0bca\u0b95\u0bc8", width: 156, align: "right" },
    { key: "difference_amount", label: "Difference Amount", tamilLabel: "\u0bb5\u0bbf\u0ba4\u0bcd\u0ba4\u0bbf\u0baf\u0bbe\u0b9a \u0ba4\u0bca\u0b95\u0bc8", width: 124, align: "right" },
  ];
}
const ROW_BATCH_SIZE = 18;

function unitLabel(unit: BaseUnit) {
  return unit === BaseUnit.KG ? "kg" : "unit";
}

function formatReportQuantity(value: string | number | null | undefined, unit?: BaseUnit) {
  const fixed = toQuantityString(value ?? 0, unit === BaseUnit.UNIT);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") || "0" : fixed;
}

function formatReportQuantityWithUnit(value: string | number | null | undefined, unit: BaseUnit) {
  return `${formatReportQuantity(value, unit)} ${unitLabel(unit)}`;
}

function formatReportMoney(value: string | number | null | undefined) {
  return `Rs. ${toMoneyString(value ?? 0)}`;
}

function formatReportDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatStatementDate(statement: OverallReportStatement) {
  const start = formatReportDate(statement.start_date);
  const end = formatReportDate(statement.end_date);
  return start === end ? start : `${start} To ${end}`;
}

function formatUsedBreakdown(row: OverallReportUsedStockBreakdown | undefined, unit: BaseUnit) {
  if (!row) return "";
  return `${row.label}\n${formatReportQuantityWithUnit(row.quantity, unit)}`;
}

function sumRetailerInventoryUsed(item: OverallReportInventoryItem) {
  return item.retailer_data?.reduce((total, entry) => money(total).plus(entry.used_stock).toString(), "0") ?? "0";
}

function sumRetailerBillingField(
  billingRow: OverallReportInventoryItem["billing_items"][number] | undefined,
  field: "assumption_quantity" | "sales_quantity" | "assumption_amount" | "sales_amount",
) {
  if (!billingRow) return "0";
  return billingRow.retailer_data.reduce(
    (total, entry) => money(total).plus(entry[field]).toString(),
    "0",
  );
}

function sumItemRetailerBillingField(
  item: OverallReportInventoryItem,
  field: "assumption_quantity" | "sales_quantity" | "assumption_amount" | "sales_amount",
) {
  return item.billing_items.reduce(
    (total, billingRow) => money(total).plus(sumRetailerBillingField(billingRow, field)).toString(),
    "0",
  );
}

function buildInventoryRows(
  statement: OverallReportStatement,
  item: OverallReportInventoryItem,
  language: ReportLanguage,
): SheetRow[] {
  const useTamil = language === "ta";
  const invDisplayName = useTamil ? (item.item_tamil_name ?? item.item_name) : item.item_name;

  const usedRows =
    item.used_stock_breakdown.length > 0
      ? item.used_stock_breakdown
      : [{ label: "Used", quantity: item.used_stock } as OverallReportUsedStockBreakdown];
  const billingRows = item.billing_items;
  const rowCount = Math.max(1, usedRows.length, billingRows.length || 1);
  const rows: SheetRow[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const isFirst = index === 0;
    const usedRow = usedRows[index];
    const billingRow = billingRows[index];
    const billingDisplayName = billingRow
      ? useTamil
        ? (billingRow.item_tamil_name ?? billingRow.item_name)
        : billingRow.item_name
      : undefined;

    const cells: string[] = [
      isFirst ? formatStatementDate(statement) : "",
      isFirst ? invDisplayName : "",
      isFirst ? formatReportQuantityWithUnit(item.old_stock, item.unit) : "",
      isFirst ? formatReportQuantityWithUnit(item.adding_stock, item.unit) : "",
      isFirst ? formatReportQuantityWithUnit(item.total_available_stock, item.unit) : "",
      formatUsedBreakdown(usedRow, item.unit),
      isFirst ? formatReportQuantityWithUnit(sumRetailerInventoryUsed(item), item.unit) : "",
      isFirst ? formatReportQuantityWithUnit(item.transfer_stock, item.unit) : "",
      formatReportQuantityWithUnit(item.remaining_stock, item.unit),
      isFirst && item.purchase_rate != null ? formatReportMoney(item.purchase_rate) : "",
      isFirst ? formatReportMoney(item.purchase_amount) : "",
      billingDisplayName ?? (isFirst && billingRows.length === 0 ? "No mapped billing sales" : ""),
      billingRow ? formatReportQuantityWithUnit(billingRow.assumption_quantity, billingRow.unit) : "",
      billingRow
        ? formatReportQuantityWithUnit(sumRetailerBillingField(billingRow, "assumption_quantity"), billingRow.unit)
        : "",
      billingRow ? formatReportQuantityWithUnit(billingRow.sales_quantity, billingRow.unit) : "",
      billingRow
        ? formatReportQuantityWithUnit(sumRetailerBillingField(billingRow, "sales_quantity"), billingRow.unit)
        : "",
      billingRow ? formatReportQuantityWithUnit(billingRow.difference_quantity, billingRow.unit) : "",
      billingRow ? formatReportMoney(billingRow.assumption_amount) : "",
      billingRow ? formatReportMoney(sumRetailerBillingField(billingRow, "assumption_amount")) : "",
      billingRow ? formatReportMoney(billingRow.sales_amount) : "",
      billingRow ? formatReportMoney(sumRetailerBillingField(billingRow, "sales_amount")) : "",
      billingRow ? formatReportMoney(billingRow.difference_amount) : "",
    ];

    rows.push({
      id: `${statement.shop_id}-${statement.start_date}-${statement.end_date}-${item.inventory_item_id}-${index}`,
      cells,
    });
  }
  return rows;
}

function splitStatementRows(statement: OverallReportStatement, language: ReportLanguage) {
  const mappedRows: SheetRow[] = [];
  const unmappedRows: SheetRow[] = [];

  for (const item of statement.inventory_items) {
    const rows = buildInventoryRows(statement, item, language);
    if (item.billing_items.length > 0) {
      mappedRows.push(...rows);
    } else {
      unmappedRows.push(...rows);
    }
  }

  return { mappedRows, unmappedRows };
}

const SheetCell = memo(function SheetCell({
  column,
  value,
  rowId,
  rowIndex,
  isTamil,
  cellWidth,
  palette,
}: {
  column: SheetColumn;
  value: string;
  rowId: string;
  rowIndex: number;
  isTamil: boolean;
  cellWidth: number;
  palette: ThemePalette;
}) {
  const isHeader = rowIndex === -1;
  const textAlign = isHeader ? "center" : column.align ?? "left";
  const useTamilFont = isTamil && (isHeader || column.key === "inventory" || column.key === "billing");
  const backgroundColor = isHeader
    ? palette.surfaceMuted
    : rowIndex % 2 === 0
      ? palette.card
      : palette.background;

  return (
    <View
      style={[
        styles.sheetCell,
        {
          width: cellWidth,
          minHeight: isHeader ? 58 : 48,
          alignItems: isHeader ? "center" : undefined,
          backgroundColor,
          borderColor: palette.border,
        },
      ]}
    >
      {isHeader && column.kgUnit ? (
        <View style={styles.sheetHeaderStack}>
          <Text
            style={[
              styles.sheetHeaderText,
              { color: palette.textPrimary, textAlign },
              useTamilFont ? { fontFamily: TAMIL_FONT } : undefined,
            ]}
          >
            {isTamil ? column.tamilLabel : column.label}
          </Text>
          <Text style={[styles.sheetHeaderText, { color: palette.textPrimary, textAlign }]}>{KG_UNIT_LABEL}</Text>
        </View>
      ) : value.includes("\n") ? (
        <View style={styles.sheetCellStack}>
          {value.split("\n").map((line, lineIndex) => (
            <Text
              key={`${rowId}-${column.key}-${lineIndex}`}
              style={[
                isHeader ? styles.sheetHeaderText : styles.sheetCellText,
                {
                  color: isHeader ? palette.textPrimary : palette.textSecondary,
                  textAlign: lineIndex > 0 && column.align === "right" ? "right" : textAlign,
                },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <Text
          style={[
            isHeader ? styles.sheetHeaderText : styles.sheetCellText,
            {
              color: isHeader ? palette.textPrimary : palette.textSecondary,
              textAlign,
            },
            useTamilFont ? { fontFamily: TAMIL_FONT } : undefined,
          ]}
        >
          {value}
        </Text>
      )}
    </View>
  );
});

const SheetDataRow = memo(function SheetDataRow({
  row,
  columns,
  columnWidths,
  palette,
  rowIndex,
  isTamil,
}: {
  row: SheetRow;
  columns: SheetColumn[];
  columnWidths: number[];
  palette: ThemePalette;
  rowIndex: number;
  isTamil: boolean;
}) {
  return (
    <View style={styles.sheetRow}>
      {columns.map((column, columnIndex) => (
        <SheetCell
          key={`${row.id}-${column.key}`}
          column={column}
          value={row.cells[columnIndex] ?? ""}
          rowId={row.id}
          rowIndex={rowIndex}
          isTamil={isTamil}
          cellWidth={columnWidths[columnIndex] ?? column.width}
          palette={palette}
        />
      ))}
    </View>
  );
});

const SheetHeaderRow = memo(function SheetHeaderRow({
  columns,
  columnWidths,
  palette,
  isTamil,
}: {
  columns: SheetColumn[];
  columnWidths: number[];
  palette: ThemePalette;
  isTamil: boolean;
}) {
  return (
    <View style={styles.sheetRow}>
      {columns.map((column, columnIndex) => (
        <SheetCell
          key={`header-${column.key}`}
          column={column}
          value={isTamil ? column.tamilLabel : column.label}
          rowId="header"
          rowIndex={-1}
          isTamil={isTamil}
          cellWidth={columnWidths[columnIndex] ?? column.width}
          palette={palette}
        />
      ))}
    </View>
  );
});

const StatementTable = memo(function StatementTable({
  rows,
  columns,
  columnWidths,
  tableWidth,
  palette,
  isTamil,
  title,
}: {
  rows: SheetRow[];
  columns: SheetColumn[];
  columnWidths: number[];
  tableWidth: number;
  palette: ThemePalette;
  isTamil: boolean;
  title?: string;
}) {
  const renderRow = useCallback(
    ({ item, index }: { item: SheetRow; index: number }) => (
      <SheetDataRow
        row={item}
        columns={columns}
        columnWidths={columnWidths}
        palette={palette}
        rowIndex={index}
        isTamil={isTamil}
      />
    ),
    [columnWidths, columns, isTamil, palette],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.tableBlock}>
      {title ? (
        <View style={styles.tableTitleWrap}>
          <Text style={[styles.tableTitle, { color: palette.textPrimary }]}>{title}</Text>
        </View>
      ) : null}
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <View style={{ width: tableWidth }}>
          <SheetHeaderRow columns={columns} columnWidths={columnWidths} palette={palette} isTamil={isTamil} />
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            scrollEnabled={false}
            initialNumToRender={ROW_BATCH_SIZE}
            maxToRenderPerBatch={ROW_BATCH_SIZE}
            windowSize={5}
            removeClippedSubviews
          />
        </View>
      </ScrollView>
    </View>
  );
});

const StatementCard = memo(function StatementCard({
  statement,
  organizationName,
  language,
  palette,
}: {
  statement: OverallReportStatement;
  organizationName?: string;
  language: ReportLanguage;
  palette: ThemePalette;
}) {
  const isTamil = language === "ta";
  const { mappedRows, unmappedRows } = useMemo(
    () => splitStatementRows(statement, language),
    [language, statement],
  );
  const profitAmount = useMemo(
    () => formatReportMoney(statement.profit_amount),
    [statement.profit_amount],
  );

  const tableConfig = useMemo(() => {
    const columns = buildSheetColumns();
    const unmappedColumns = [];
    for (const c of columns) {
      if (c.key === "billing") break;
      unmappedColumns.push(c);
    }
    const fullWidths = columns.map((c) => c.width);
    const unmappedWidths = unmappedColumns.map((c) => c.width);
    const fullWidth = fullWidths.reduce((a, b) => a + b, 0);
    const unmappedWidth = unmappedWidths.reduce((a, b) => a + b, 0);
    return {
      sheetColumns: columns,
      unmappedSheetColumns: unmappedColumns,
      fullColumnWidths: fullWidths,
      unmappedColumnWidths: unmappedWidths,
      fullTableWidth: fullWidth,
      unmappedTableWidth: unmappedWidth,
    };
  }, []);

  return (
    <View
      style={[
        styles.statementPanel,
        adminElevation(1),
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.statementHeader}>
        <Text style={[styles.companyTitle, { color: palette.textPrimary }]}>
          {organizationName || "DUROZEN"}
        </Text>
        <Text style={[styles.branchTitle, { color: palette.textPrimary }]}>
          {statement.shop_name.toUpperCase()}
        </Text>
        <Text style={[styles.statementTitle, { color: palette.textSecondary }]}>Statement</Text>
        <Text style={[styles.statementDate, { color: palette.textMuted }]}>
          Date: {formatStatementDate(statement)}
        </Text>
      </View>

      {mappedRows.length === 0 && unmappedRows.length === 0 ? (
        <View style={[styles.reportEmptyRow, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.reportEmptyText, { color: palette.textMuted }]}>
            No allocated inventory items
          </Text>
        </View>
      ) : (
        <View style={styles.tableStack}>
          <StatementTable
            rows={mappedRows}
            columns={tableConfig.sheetColumns}
            columnWidths={tableConfig.fullColumnWidths}
            tableWidth={tableConfig.fullTableWidth}
            palette={palette}
            isTamil={isTamil}
          />
          {unmappedRows.length > 0 ? (
            <StatementTable
              rows={unmappedRows}
              columns={tableConfig.unmappedSheetColumns}
              columnWidths={tableConfig.unmappedColumnWidths}
              tableWidth={tableConfig.unmappedTableWidth}
              palette={palette}
              isTamil={isTamil}
              title={mappedRows.length > 0 ? "No mapped billing Items" : undefined}
            />
          ) : null}
        </View>
      )}

      {(mappedRows.length > 0 || unmappedRows.length > 0) && (
        <View style={[styles.summaryPanel, { borderColor: palette.border }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>Total Sales</Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.sales_amount)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>
              Total Retailer Paid Amount
            </Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.retailer_paid_amount)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>Total Purchase</Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.purchase_amount)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>Total Expense (Cash)</Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.expense_cash_amount ?? 0)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>Total Expense (UPI)</Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.expense_upi_amount ?? 0)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>Total Expense Amount</Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.expense_amount)}
            </Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowTotal, { borderTopColor: palette.border }]}>
            <Text style={[styles.summaryLabelTotal, { color: palette.textPrimary }]}>Profit Amount</Text>
            <Text style={[styles.summaryValueTotal, { color: palette.primary }]}>{profitAmount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>
              Retailer Balance Amount
            </Text>
            <Text style={[styles.summaryValue, { color: palette.textPrimary }]}>
              {formatReportMoney(statement.retailer_balance_amount)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
});

export function AdminOverallReportPreviewScreen({
  navigation,
  route,
}: AdminOverallReportPreviewScreenProps) {
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<OverallReportRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [language, setLanguage] = useState<ReportLanguage>(route.params.language ?? "en");

  const reportParams = useMemo<FetchOverallReportParams>(
    () => ({
      detailLevel: route.params.detailLevel,
      period: route.params.period,
      referenceDate:
        route.params.period === AnalyticsPeriod.RANGE ? undefined : route.params.referenceDate,
      range: route.params.period === AnalyticsPeriod.RANGE ? route.params.range : undefined,
      shopIds: route.params.shopIds,
    }),
    [
      route.params.detailLevel,
      route.params.period,
      route.params.range,
      route.params.referenceDate,
      route.params.shopIds,
    ],
  );

  const canGenerate = route.params.sections.length > 0 && !generating;
  const subtitle = report?.period_label ?? route.params.period;

  const loadReport = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setErrorMessage(null);
      try {
        const nextReport = await fetchAdminOverallReport(reportParams);
        setReport(nextReport);
      } catch (error) {
        setErrorMessage(formatApiErrorMessage(error, "Overall report preview could not be loaded."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [reportParams],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErrorMessage(null);
    fetchAdminOverallReport(reportParams, { signal: controller.signal })
      .then(setReport)
      .catch((error) => {
        if (!isApiRequestCanceled(error)) {
          setErrorMessage(
            formatApiErrorMessage(error, "Overall report preview could not be loaded."),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reportParams]);

  const handleGenerate = useCallback(
    async (lang: ReportLanguage) => {
      if (!canGenerate) return;
      setGenerating(true);
      setErrorMessage(null);
      try {
        const result = await downloadAdminReportPdf({
          ...reportParams,
          sections: route.params.sections,
          language: lang,
        });
        const sharingModule =
          requireOptionalNativeModule<ExpoSharingNativeModule>("ExpoSharing");
        let shared = false;
        if (sharingModule?.shareAsync) {
          const sharingAvailable = sharingModule.isAvailableAsync
            ? await sharingModule.isAvailableAsync().catch(() => false)
            : true;
          if (sharingAvailable) {
            await sharingModule
              .shareAsync(result.uri, {
                dialogTitle: "Admin report",
                mimeType: "application/pdf",
                UTI: "com.adobe.pdf",
              })
              .then(() => { shared = true; })
              .catch(() => { shared = false; });
          }
        }
        if (!shared) {
          Alert.alert("Report downloaded", result.filename);
        }
      } catch (error) {
        setErrorMessage(formatApiErrorMessage(error, "Report could not be generated."));
      } finally {
        setGenerating(false);
      }
    },
    [canGenerate, reportParams, route.params.sections],
  );

  const renderStatement = useCallback(
    ({ item: statement }: { item: OverallReportStatement }) => (
      <StatementCard
        statement={statement}
        organizationName={report?.organization_name}
        language={language}
        palette={palette}
      />
    ),
    [language, palette, report?.organization_name],
  );

  const renderListHeader = () => (
    <View style={styles.headerContent}>
      {errorMessage ? (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: palette.dangerSoft, borderColor: palette.danger },
          ]}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}
      {loading && !report ? (
        <View style={styles.loadingPanel}>
          <ActivityIndicator size="small" color={palette.primary} />
        </View>
      ) : null}
    </View>
  );

  const renderFooter = () => (
    <View
      style={[
        styles.footer,
        { paddingBottom: 18 + insets.bottom, backgroundColor: palette.background },
      ]}
    >
      {/* Language selector */}
      <View
        style={[
          styles.languageToggle,
          { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: language === "en" }}
          onPress={() => setLanguage("en")}
          style={[
            styles.languageChip,
            { backgroundColor: language === "en" ? palette.primary : "transparent" },
          ]}
        >
          <MaterialCommunityIcons
            name="alphabetical"
            size={15}
            color={language === "en" ? palette.onPrimary : palette.textSecondary}
          />
          <Text
            style={[
              styles.languageChipText,
              { color: language === "en" ? palette.onPrimary : palette.textSecondary },
            ]}
          >
            English
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: language === "ta" }}
          onPress={() => setLanguage("ta")}
          style={[
            styles.languageChip,
            { backgroundColor: language === "ta" ? palette.primary : "transparent" },
          ]}
        >
          <MaterialCommunityIcons
            name="translate"
            size={15}
            color={language === "ta" ? palette.onPrimary : palette.textSecondary}
          />
          {/* Render Tamil label with NotoSansTamil font */}
          <Text
            style={[
              styles.languageChipText,
              {
                color: language === "ta" ? palette.onPrimary : palette.textSecondary,
                fontFamily: TAMIL_FONT,
              },
            ]}
          >
            {"\u0ba4\u0bae\u0bbf\u0bb4\u0bcd"}
          </Text>
          <Text
            style={[
              styles.languageChipTextSub,
              { color: language === "ta" ? palette.onPrimary : palette.textSecondary },
            ]}
          >
            (Tamil)
          </Text>
        </Pressable>
      </View>

      {/* Generate PDF button */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canGenerate }}
        disabled={!canGenerate}
        onPress={() => void handleGenerate(language)}
        style={[
          styles.generateButton,
          {
            backgroundColor: canGenerate ? palette.primary : palette.surfaceMuted,
            opacity: canGenerate ? 1 : 0.72,
          },
        ]}
      >
        {generating ? (
          <ActivityIndicator size="small" color={palette.onPrimary} />
        ) : (
          <MaterialCommunityIcons name="file-pdf-box" size={21} color={palette.onPrimary} />
        )}
        <Text style={[styles.generateButtonText, { color: palette.onPrimary }]}>
          {generating
            ? "Generating..."
            : `Generate PDF`}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: palette.shell,
            borderBottomColor: palette.shellBorder,
            paddingTop: Math.max(insets.top - 8, 0),
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            Overall Report
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {subtitle}
          </Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing || loading}
          onRefresh={() => void loadReport(true)}
        />
      </View>

      <FlatList
        data={report?.statements ?? []}
        keyExtractor={(statement) =>
          `${statement.shop_id}-${statement.start_date}-${statement.end_date}`
        }
        renderItem={renderStatement}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          !loading && !errorMessage ? (
            <View style={[styles.reportEmptyRow, { backgroundColor: palette.surfaceMuted }]}>
              <Text style={[styles.reportEmptyText, { color: palette.textMuted }]}>
                No branch data available
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadReport(true)}
            tintColor={palette.primary}
            colors={[palette.primary]}
          />
        }
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={64}
        windowSize={5}
        removeClippedSubviews
        extraData={language}
        showsVerticalScrollIndicator={false}
      />
      {renderFooter()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    minHeight: 64,
    paddingHorizontal: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  summaryPanel: {
    marginTop: adminSpacing.xl,
    paddingTop: adminSpacing.md,
    borderTopWidth: 1,
    paddingHorizontal: adminSpacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: adminSpacing.xxs,
  },
  summaryRowTotal: {
    marginTop: adminSpacing.xs,
    paddingTop: adminSpacing.xs,
    borderTopWidth: 1,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  summaryLabelTotal: {
    fontSize: 15,
    fontWeight: "700",
  },
  summaryValueTotal: {
    fontSize: 16,
    fontWeight: "700",
  },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { ...adminTypography.pageTitle, },
  subtitle: { ...adminTypography.caption,
    marginTop: 2, },
  listContent: { paddingHorizontal: adminSpacing.sm, paddingTop: adminSpacing.md, paddingBottom: 18 },
  headerContent: { gap: adminSpacing.sm, marginBottom: adminSpacing.sm },
  errorBanner: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: adminRadii.card,
    paddingHorizontal: adminSpacing.sm,
    paddingVertical: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  errorText: { flex: 1, ...adminTypography.caption, },
  loadingPanel: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  statementPanel: { borderWidth: 1, borderRadius: adminRadii.card, overflow: "hidden" },
  tableStack: { gap: adminSpacing.md },
  tableBlock: { width: "100%" },
  tableTitleWrap: {
    width: "100%",
    alignItems: "center",
    marginBottom: adminSpacing.sm,
    marginTop: adminSpacing.xxs,
  },
  tableTitle: { ...adminTypography.bodyStrong, textAlign: "center" },
  statementHeader: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: adminSpacing.sm,
    paddingVertical: adminSpacing.sm,
  },
  companyTitle: { fontSize: 16, lineHeight: 21, fontWeight: "900", textAlign: "center" },
  branchTitle: { marginTop: 2, fontSize: 14, lineHeight: 19, fontWeight: "900", textAlign: "center" },
  statementTitle: { marginTop: adminSpacing.xxs, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  statementDate: { marginTop: 3, fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  sheetRow: { flexDirection: "row" },
  sheetCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 7,
    justifyContent: "center",
  },
  sheetHeaderText: { fontSize: 10, lineHeight: 14, fontWeight: "900", textAlign: "center" },
  sheetHeaderStack: { alignItems: "center", gap: 2 },
  sheetCellStack: { width: "100%", gap: 2 },
  sheetCellText: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  reportEmptyRow: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: adminSpacing.sm,
  },
  reportEmptyText: { ...adminTypography.bodyStrong, textAlign: "center" },
  footer: { paddingHorizontal: adminSpacing.md, paddingTop: adminSpacing.sm, gap: adminSpacing.sm },
  languageToggle: {
    flexDirection: "row",
    borderRadius: adminRadii.control,
    borderWidth: 1,
    padding: adminSpacing.xxs,
    gap: adminSpacing.xxs,
  },
  languageChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: adminRadii.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: adminSpacing.sm,
  },
  languageChipText: { fontSize: 13, fontWeight: "700" },
  languageChipTextSub: { fontSize: 11, fontWeight: "600" },
  generateButton: {
    minHeight: 54,
    borderRadius: adminRadii.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: adminSpacing.sm,
    paddingHorizontal: 18,
  },
  generateButtonText: { ...adminTypography.sectionTitle, },
});
