import { MaterialCommunityIcons } from "@expo/vector-icons";
import { requireOptionalNativeModule } from "expo-modules-core";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { isApiRequestCanceled, toApiError } from "@/api/client";
import type { AdminOverallReportPreviewScreenProps } from "@/navigation/types";
import {
  AnalyticsPeriod,
  BaseUnit,
  type OverallReportInventoryItem,
  type OverallReportRead,
  type OverallReportStatement,
  type OverallReportUsedStockBreakdown,
} from "@/types/api";
import { toMoneyString, toQuantityString } from "@/utils/decimal";

import { adminShadow } from "./admin-dashboard-theme";
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

type SheetColumn = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "center" | "right";
};

type SheetRow = {
  id: string;
  cells: string[];
};

const SHEET_COLUMNS: SheetColumn[] = [
  { key: "date", label: "Date", width: 92, align: "center" },
  { key: "inventory", label: "Inventory Item", width: 132 },
  { key: "old", label: "Old Stock (kg / Unit)", width: 118, align: "right" },
  { key: "adding", label: "Adding Stock (kg / Unit)", width: 126, align: "right" },
  { key: "available", label: "Total Available Stock (kg / Unit)", width: 136, align: "right" },
  { key: "used", label: "Used Stock (kg / Unit)", width: 138 },
  { key: "remaining", label: "Remaining Stock (kg / Unit)", width: 126, align: "right" },
  { key: "billing", label: "Billing Items", width: 142 },
  { key: "assumption", label: "Assumption (kg / Unit)", width: 132, align: "right" },
  { key: "sales", label: "Sales (kg / Unit)", width: 112, align: "right" },
  { key: "difference", label: "Difference (kg / Unit)", width: 120, align: "right" },
  { key: "assumption_amount", label: "Assumption Amount", width: 124, align: "right" },
  { key: "sales_amount", label: "Sales Amount", width: 112, align: "right" },
  { key: "difference_amount", label: "Difference Amount", width: 124, align: "right" },
];

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
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year}`;
}

function formatStatementDate(statement: OverallReportStatement) {
  const start = formatReportDate(statement.start_date);
  const end = formatReportDate(statement.end_date);
  return start === end ? start : `${start} To ${end}`;
}

function formatUsedBreakdown(
  row: OverallReportUsedStockBreakdown | undefined,
  unit: BaseUnit,
) {
  if (!row) {
    return "";
  }
  return `${row.label}: ${formatReportQuantityWithUnit(row.quantity, unit)}`;
}

function buildStatementRows(statement: OverallReportStatement): SheetRow[] {
  return statement.inventory_items.flatMap((item) => buildInventoryRows(statement, item));
}

function buildInventoryRows(
  statement: OverallReportStatement,
  item: OverallReportInventoryItem,
): SheetRow[] {
  const usedRows = item.used_stock_breakdown.length > 0
    ? item.used_stock_breakdown
    : [{ label: "Used", quantity: item.used_stock } as OverallReportUsedStockBreakdown];
  const billingRows = item.billing_items;
  const rowCount = Math.max(1, usedRows.length, billingRows.length || 1);
  const rows: SheetRow[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const isFirst = index === 0;
    const usedRow = usedRows[index];
    const billingRow = billingRows[index];
    rows.push({
      id: `${statement.shop_id}-${statement.start_date}-${statement.end_date}-${item.inventory_item_id}-${index}`,
      cells: [
        isFirst ? formatStatementDate(statement) : "",
        isFirst ? item.item_name : "",
        isFirst ? formatReportQuantityWithUnit(item.old_stock, item.unit) : "",
        isFirst ? formatReportQuantityWithUnit(item.adding_stock, item.unit) : "",
        isFirst ? formatReportQuantityWithUnit(item.total_available_stock, item.unit) : "",
        formatUsedBreakdown(usedRow, item.unit),
        isFirst ? formatReportQuantityWithUnit(item.remaining_stock, item.unit) : "",
        billingRow?.item_name ?? (isFirst && billingRows.length === 0 ? "No mapped billing sales" : ""),
        billingRow ? formatReportQuantityWithUnit(billingRow.assumption_quantity, billingRow.unit) : "",
        billingRow ? formatReportQuantityWithUnit(billingRow.sales_quantity, billingRow.unit) : "",
        billingRow ? formatReportQuantityWithUnit(billingRow.difference_quantity, billingRow.unit) : "",
        billingRow ? formatReportMoney(billingRow.assumption_amount) : "",
        billingRow ? formatReportMoney(billingRow.sales_amount) : "",
        billingRow ? formatReportMoney(billingRow.difference_amount) : "",
      ],
    });
  }
  return rows;
}

export function AdminOverallReportPreviewScreen({
  navigation,
  route,
}: AdminOverallReportPreviewScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<OverallReportRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reportParams = useMemo<FetchOverallReportParams>(() => ({
    detailLevel: route.params.detailLevel,
    period: route.params.period,
    referenceDate:
      route.params.period === AnalyticsPeriod.RANGE ? undefined : route.params.referenceDate,
    range:
      route.params.period === AnalyticsPeriod.RANGE
        ? route.params.range
        : undefined,
    shopIds: route.params.shopIds,
  }), [
    route.params.detailLevel,
    route.params.period,
    route.params.range,
    route.params.referenceDate,
    route.params.shopIds,
  ]);

  const canGenerate = route.params.sections.length > 0 && !generating;
  const subtitle = report?.period_label ?? route.params.period;

  const loadReport = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const nextReport = await fetchAdminOverallReport(reportParams);
      setReport(nextReport);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Overall report preview could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [reportParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErrorMessage(null);
    fetchAdminOverallReport(reportParams, { signal: controller.signal })
      .then(setReport)
      .catch((error) => {
        if (!isApiRequestCanceled(error)) {
          setErrorMessage(toApiError(error).message || "Overall report preview could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reportParams]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) {
      return;
    }
    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await downloadAdminReportPdf({
        ...reportParams,
        sections: route.params.sections,
      });
      const sharingModule = requireOptionalNativeModule<ExpoSharingNativeModule>("ExpoSharing");
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
            .then(() => {
              shared = true;
            })
            .catch(() => {
              shared = false;
            });
        }
      }
      if (!shared) {
        Alert.alert("Report downloaded", result.filename);
      }
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Report could not be generated.");
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, reportParams, route.params.sections]);

  const renderCell = (column: SheetColumn, value: string, rowId: string, rowIndex: number) => (
    <View
      key={`${rowId}-${column.key}`}
      style={[
        styles.sheetCell,
        {
          width: column.width,
          minHeight: rowIndex === -1 ? 58 : 48,
          backgroundColor: rowIndex === -1
            ? palette.surfaceMuted
            : rowIndex % 2 === 0
              ? palette.card
              : palette.background,
          borderColor: palette.border,
        },
      ]}
    >
      <Text
        style={[
          rowIndex === -1 ? styles.sheetHeaderText : styles.sheetCellText,
          {
            color: rowIndex === -1 ? palette.textPrimary : palette.textSecondary,
            textAlign: column.align ?? "left",
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  const renderStatement = ({ item: statement }: { item: OverallReportStatement }) => {
    const rows = buildStatementRows(statement);
    return (
      <View
        style={[
          styles.statementPanel,
          adminShadow(palette.shadow, 0.04, 8, 10),
          { backgroundColor: palette.card, borderColor: palette.border },
        ]}
      >
        <View style={styles.statementHeader}>
          <Text style={[styles.companyTitle, { color: palette.textPrimary }]}>SRI MAHALAKSHMI BROILERS</Text>
          <Text style={[styles.branchTitle, { color: palette.textPrimary }]}>
            {statement.shop_name.toUpperCase()} - BRANCH
          </Text>
          <Text style={[styles.statementTitle, { color: palette.textSecondary }]}>Statement</Text>
          <Text style={[styles.statementDate, { color: palette.textMuted }]}>
            Date: {formatStatementDate(statement)}
          </Text>
        </View>
        {rows.length === 0 ? (
          <View style={[styles.reportEmptyRow, { backgroundColor: palette.surfaceMuted }]}>
            <Text style={[styles.reportEmptyText, { color: palette.textMuted }]}>No allocated inventory items</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={styles.sheetRow}>
                {SHEET_COLUMNS.map((column) => renderCell(column, column.label, "header", -1))}
              </View>
              {rows.map((row, index) => (
                <View key={row.id} style={styles.sheetRow}>
                  {SHEET_COLUMNS.map((column, columnIndex) => renderCell(column, row.cells[columnIndex] ?? "", row.id, index))}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    );
  };

  const renderListHeader = () => (
    <View style={styles.headerContent}>
      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
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
    <View style={[styles.footer, { paddingBottom: 18 + insets.bottom, backgroundColor: palette.background }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canGenerate }}
        disabled={!canGenerate}
        onPress={handleGenerate}
        style={[
          styles.generateButton,
          adminShadow(palette.shadow, 0.08, 10, 14),
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
          {generating ? "Generating..." : "Generate PDF"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>Overall Report</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {subtitle}
          </Text>
        </View>
        <AdminHeaderActions refreshing={refreshing || loading} onRefresh={() => void loadReport(true)} />
      </View>

      <FlatList
        data={report?.statements ?? []}
        keyExtractor={(statement) => `${statement.shop_id}-${statement.start_date}-${statement.end_date}`}
        renderItem={renderStatement}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          !loading && !errorMessage ? (
            <View style={[styles.reportEmptyRow, { backgroundColor: palette.surfaceMuted }]}>
              <Text style={[styles.reportEmptyText, { color: palette.textMuted }]}>No branch data available</Text>
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
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={48}
        windowSize={7}
        extraData={`${refreshing}-${loading}-${generating}-${errorMessage ?? ""}`}
        showsVerticalScrollIndicator={false}
      />
      {renderFooter()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerContent: {
    gap: 12,
    marginBottom: 12,
  },
  errorBanner: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  loadingPanel: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  statementPanel: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  statementHeader: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  companyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  branchTitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    textAlign: "center",
  },
  statementTitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  statementDate: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  sheetRow: {
    flexDirection: "row",
  },
  sheetCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 7,
    justifyContent: "center",
  },
  sheetHeaderText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  sheetCellText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  reportEmptyRow: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  reportEmptyText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  generateButton: {
    minHeight: 54,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: "800",
  },
});
