import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Controller, useForm } from "react-hook-form";

import { fetchShopRetailerSale, recordShopRetailerPayment } from "@/api/retailer-sales";
import { buildRetailerReceiptHtml } from "@/api/retailer-receipts";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { ShopHeaderActions } from "@/components/shop-header";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { getLocalizedItemName, useShopTranslation, type ShopTranslationKey } from "@/hooks/use-shop-translation";
import type { RetailerSaleDetailScreenProps } from "@/navigation/types";
import { usePrinterStore } from "@/store/printer-store";
import {
  RetailerReceiptType,
  RetailerSaleStatus,
  type RetailerSaleRead,
  type RetailerSaleReceiptRead,
} from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency, formatDateTime, formatUnit } from "@/utils/format";
import { formatRetailerSaleNoDisplay } from "@/utils/retailer-sale";

type FormValues = { cashAmount: string; upiAmount: string };

function saleStatusLabel(status: RetailerSaleStatus, t: (key: ShopTranslationKey) => string) {
  switch (status) {
    case RetailerSaleStatus.SETTLED:
      return t("retailers.statusSettled");
    case RetailerSaleStatus.PARTIAL:
      return t("retailers.statusPartial");
    case RetailerSaleStatus.OPEN:
      return t("retailers.statusOpen");
    default:
      return status;
  }
}

function saleStatusTone(status: RetailerSaleStatus): "success" | "warning" | "neutral" {
  if (status === RetailerSaleStatus.SETTLED) return "success";
  if (status === RetailerSaleStatus.PARTIAL) return "warning";
  return "neutral";
}

function receiptTypeLabel(
  receiptType: RetailerReceiptType,
  t: (key: ShopTranslationKey) => string,
) {
  return receiptType === RetailerReceiptType.BALANCE_PAYMENT
    ? t("retailers.receiptBalancePayment")
    : t("retailers.receiptSaleInvoice");
}

function receiptTypeTone(
  receiptType: RetailerReceiptType,
): "success" | "warning" | "neutral" {
  return receiptType === RetailerReceiptType.BALANCE_PAYMENT ? "success" : "neutral";
}

export function RetailerSaleDetailScreen({ navigation, route }: RetailerSaleDetailScreenProps) {
  const { saleId } = route.params;
  const { language, t } = useShopTranslation();
  const [sale, setSale] = useState<RetailerSaleRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const preferredPrinter = usePrinterStore((s) => s.preferredPrinter);
  const form = useForm<FormValues>({ defaultValues: { cashAmount: "", upiAmount: "" } });
  const { receiptImagePrintBridge, startReceiptHtmlPrintJob } = useReceiptImagePrintJob();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSale(await fetchShopRetailerSale(saleId));
    } catch (error) {
      Alert.alert(t("retailers.loadFailed"), formatApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [saleId, t]);

  const handleRefresh = useCallback(() => {
    void load();
  }, [load]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: handleRefresh,
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

  const printReceipt = useCallback(
    async (targetSale: RetailerSaleRead, receipt: RetailerSaleReceiptRead) => {
      if (!preferredPrinter) {
        Alert.alert(t("printer.selectPrinterFirstTitle"), t("printer.selectPrinterFirstMessage"));
        return;
      }
      setReprintingId(receipt.id);
      try {
        await startReceiptHtmlPrintJob(
          [buildRetailerReceiptHtml(targetSale, receipt, language)],
          preferredPrinter,
          language,
        );
      } catch (error) {
        Alert.alert(t("checkout.checkoutFailedTitle"), formatApiErrorMessage(error));
      } finally {
        setReprintingId(null);
      }
    },
    [language, preferredPrinter, startReceiptHtmlPrintJob, t],
  );

  const onCollect = form.handleSubmit(async (values) => {
    if (!sale || money(sale.balance_due).lessThanOrEqualTo(0)) return;
    const paid = money(values.cashAmount).plus(money(values.upiAmount));
    if (paid.lessThanOrEqualTo(0)) {
      Alert.alert(t("retailers.enterPayment"));
      return;
    }
    if (paid.greaterThan(money(sale.balance_due))) {
      Alert.alert(t("checkout.checkoutFailedTitle"), t("retailers.overpay"));
      return;
    }
    if (!preferredPrinter) {
      Alert.alert(t("printer.selectPrinterFirstTitle"), t("printer.selectPrinterFirstMessage"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await recordShopRetailerPayment(saleId, {
        payment: {
          cash_amount: toMoneyString(values.cashAmount),
          upi_amount: toMoneyString(values.upiAmount),
        },
      });
      await startReceiptHtmlPrintJob(
        [buildRetailerReceiptHtml(result.sale, result.payment_receipt, language)],
        preferredPrinter,
        language,
      );
      setSale(result.sale);
      form.reset({ cashAmount: "", upiAmount: "" });
    } catch (error) {
      Alert.alert(t("checkout.checkoutFailedTitle"), formatApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  });

  if (loading || !sale) {
    return <LoadingState label={t("retailers.loading")} />;
  }

  const hasBalance = money(sale.balance_due).greaterThan(0);
  const receipts = sale.receipts ?? (sale.receipt ? [sale.receipt] : []);

  return (
    <Screen topInset={false}>
      <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-lg font-bold text-ink" style={{ fontVariant: ["tabular-nums"] }}>
                {formatRetailerSaleNoDisplay(sale.sale_no)}
              </Text>
              <Text className="text-sm text-muted">{formatDateTime(sale.created_at)}</Text>
              <Text className="text-sm text-muted">{sale.retailer_name}</Text>
            </View>
            <StatusPill
              label={saleStatusLabel(sale.status, t)}
              tone={saleStatusTone(sale.status)}
            />
          </View>
          <View className="flex-row justify-between">
            <Text className="text-muted">{t("billing.cartLiveTotal")}</Text>
            <Text className="font-semibold">{formatCurrency(sale.total_amount)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-muted">{t("common.paidAmount")}</Text>
            <Text className="font-semibold">{formatCurrency(sale.amount_paid_total)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-muted">{t("retailers.balanceDue")}</Text>
            <Text className="text-lg font-bold text-ink">{formatCurrency(sale.balance_due)}</Text>
          </View>
        </Card>

        {hasBalance ? (
          <Card className="gap-3">
            <Text className="font-semibold text-ink">{t("retailers.collectPayment")}</Text>
            <Controller
              control={form.control}
              name="cashAmount"
              render={({ field }) => (
                <TextField
                  label={t("checkout.cashAmount")}
                  keyboardType="decimal-pad"
                  value={field.value}
                  onChangeText={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="upiAmount"
              render={({ field }) => (
                <TextField
                  label={t("checkout.upiAmount")}
                  keyboardType="decimal-pad"
                  value={field.value}
                  onChangeText={field.onChange}
                />
              )}
            />
            <Button
              label={t("retailers.collectAndPrint")}
              onPress={onCollect}
              loading={submitting}
            />
          </Card>
        ) : null}

        <Card className="gap-3">
          <SectionHeading title={t("retailers.saleItems")} />
          {sale.items.map((line) => {
            const displayName = getLocalizedItemName(
              language,
              line.item_name,
              line.item_tamil_name,
            );
            return (
              <View
                key={`${line.item_id}-${line.quantity}-${line.price_per_unit}`}
                className="flex-row items-center justify-between border-b border-border py-2 last:border-b-0"
              >
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="font-semibold text-ink" numberOfLines={2}>
                    {displayName}
                  </Text>
                  <Text className="text-sm text-muted">
                    {line.quantity} {formatUnit(line.unit)} × {formatCurrency(line.price_per_unit)}
                  </Text>
                </View>
                <Text className="font-semibold text-ink">{formatCurrency(line.line_total)}</Text>
              </View>
            );
          })}
        </Card>

        {sale.payments.length > 0 ? (
          <Card className="gap-3">
            <SectionHeading title={t("retailers.paymentHistory")} />
            {sale.payments.map((payment) => (
              <View
                key={payment.id}
                className="border-b border-border py-2 last:border-b-0"
              >
                <Text className="text-sm text-muted">{formatDateTime(payment.paid_at)}</Text>
                <Text className="font-semibold text-ink">
                  {formatCurrency(payment.total_paid)} · {t("checkout.cashAmount")}{" "}
                  {formatCurrency(payment.cash_amount)} · {t("checkout.upiAmount")}{" "}
                  {formatCurrency(payment.upi_amount)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {receipts.length > 0 ? (
          <Card className="gap-3">
            <SectionHeading title={t("retailers.receiptHistory")} />
            {receipts.map((receipt) => (
              <View
                key={receipt.id}
                className="flex-row items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
              >
                <View className="min-w-0 flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <StatusPill
                      label={receiptTypeLabel(receipt.receipt_type, t)}
                      tone={receiptTypeTone(receipt.receipt_type)}
                    />
                    <Text className="text-sm text-muted">{formatDateTime(receipt.printed_at)}</Text>
                  </View>
                  <Text className="font-semibold text-ink" numberOfLines={1}>
                    {receipt.receipt_number}
                  </Text>
                  {receipt.payment_total ? (
                    <Text className="text-sm text-muted">
                      {formatCurrency(receipt.payment_total)}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label={t("retailers.reprintReceipt")}
                  variant="secondary"
                  onPress={() => void printReceipt(sale, receipt)}
                  loading={reprintingId === receipt.id}
                />
              </View>
            ))}
          </Card>
        ) : null}
      {receiptImagePrintBridge}
    </Screen>
  );
}
