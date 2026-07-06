import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  fetchShopBill,
  patchBillReceiptStatus,
  reprintShopBill,
} from "@/api/billing";
import { toApiError } from "@/api/client";
import { ShopHeaderActions } from "@/components/shop-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { StatusPill } from "@/components/ui/status-pill";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import type { ShopBillDetailScreenProps } from "@/navigation/types";
import {
  getPrinterDeviceDetail,
  getSavedPrinterLabel,
} from "@/services/printer-service";
import type { BillRead, ReceiptStatus } from "@/types/api";
import { usePrinterStore } from "@/store/printer-store";
import { formatCurrency, formatDateTime } from "@/utils/format";

function receiptStatusLabel(status: ReceiptStatus, t: ReturnType<typeof useShopTranslation>["t"]) {
  switch (status) {
    case "printed":
      return t("bills.receiptPrinted");
    case "pending":
      return t("bills.receiptPending");
    case "failed":
      return t("bills.receiptFailed");
    default:
      return status;
  }
}

function receiptStatusTone(status: ReceiptStatus): "success" | "warning" | "danger" {
  if (status === "printed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

export function ShopBillDetailScreen({ navigation, route }: ShopBillDetailScreenProps) {
  const { billId } = route.params;
  const { language, t } = useShopTranslation();
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);
  const [bill, setBill] = useState<BillRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprinting, setReprinting] = useState(false);
  const { receiptImagePrintBridge, startReceiptImagePrintJob } = useReceiptImagePrintJob();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBill(await fetchShopBill(billId));
    } catch (error) {
      Alert.alert(t("bills.loadFailed"), toApiError(error).message);
    } finally {
      setLoading(false);
    }
  }, [billId, t]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: () => {
      void load();
    },
    refreshing: loading,
  });

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  async function handleReprint() {
    if (!bill) return;
    if (!preferredPrinter) {
      Alert.alert(t("printer.selectPrinterFirstTitle"), t("printer.selectPrinterFirstMessage"));
      return;
    }

    setReprinting(true);
    try {
      const printable = await reprintShopBill(bill.id);
      setBill(printable);
      await startReceiptImagePrintJob([printable], preferredPrinter, language);
      const updated = await patchBillReceiptStatus(printable.id, { status: "printed" });
      setBill(updated);
    } catch (error) {
      const printError = error instanceof Error ? error.message : t("checkout.unableToOpenPrinterMessage");
      try {
        if (bill) {
          const updated = await patchBillReceiptStatus(bill.id, {
            status: "failed",
            error: printError,
          });
          setBill(updated);
        }
      } catch {
        // Best-effort status update.
      }
      Alert.alert(t("checkout.printFailedAfterSaveTitle"), toApiError(error).message);
    } finally {
      setReprinting(false);
    }
  }

  if (loading || !bill) {
    return <LoadingState label={t("bills.loadingDetail")} />;
  }

  const printerLabel = preferredPrinter ? getSavedPrinterLabel(preferredPrinter) : null;
  const printerDetail = preferredPrinter ? getPrinterDeviceDetail(preferredPrinter) : null;

  return (
    <Screen topInset={false}>
      {receiptImagePrintBridge}
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-bold text-ink" style={{ fontVariant: ["tabular-nums"] }}>
                {bill.bill_no}
              </Text>
              <Text className="text-sm text-muted">{formatDateTime(bill.created_at)}</Text>
              {bill.created_by_name ? (
                <Text className="text-sm text-muted">
                  {t("bills.createdBy")}: {bill.created_by_name}
                </Text>
              ) : null}
            </View>
            <StatusPill
              label={receiptStatusLabel(bill.receipt.receipt_status, t)}
              tone={receiptStatusTone(bill.receipt.receipt_status)}
            />
          </View>

          {bill.receipt.receipt_status === "failed" && bill.receipt.last_print_error ? (
            <Text className="text-sm leading-5 text-danger">{bill.receipt.last_print_error}</Text>
          ) : null}

          <View className="flex-row justify-between">
            <Text className="text-muted">{t("billing.cartLiveTotal")}</Text>
            <Text className="font-semibold">{formatCurrency(bill.total_amount)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-muted">{t("common.paidAmount")}</Text>
            <Text className="font-semibold">{formatCurrency(bill.payment.total_paid)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-muted">{t("common.balanceAmount")}</Text>
            <Text className="font-semibold">{formatCurrency(bill.payment.balance)}</Text>
          </View>
        </Card>

        <Card className="gap-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("receipt.purchasedItems")}
          </Text>
          {bill.items.map((item) => (
            <View key={`${item.item_id}-${item.quantity}`} className="gap-1 border-b border-border/70 pb-3">
              <Text className="font-semibold text-ink">{item.item_name}</Text>
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted">
                  {item.quantity} × {formatCurrency(item.price_per_unit)}
                </Text>
                <Text className="text-sm font-semibold text-ink">{formatCurrency(item.line_total)}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card className="gap-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("common.savedPrinter")}
          </Text>
          <Text className="text-base font-semibold text-ink">
            {printerLabel ?? t("printer.noPrinterSavedYet")}
          </Text>
          {printerDetail ? <Text className="text-sm text-muted">{printerDetail}</Text> : null}
          <Button
            label={
              bill.receipt.receipt_status === "failed"
                ? t("bills.reprintNow")
                : t("bills.reprintReceipt")
            }
            onPress={() => {
              void handleReprint();
            }}
            loading={reprinting}
            className="self-start"
          />
        </Card>
      </View>
    </Screen>
  );
}
