import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Controller, useForm, useWatch } from "react-hook-form";

import { commitRetailerSale, previewRetailerSale } from "@/api/retailer-sales";
import { buildRetailerSaleInvoiceHtml } from "@/api/retailer-receipts";
import { toApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { ShopHeaderActions } from "@/components/shop-header";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { getLocalizedItemName, useShopTranslation } from "@/hooks/use-shop-translation";
import type { RetailerCheckoutScreenProps } from "@/navigation/types";
import { usePrinterStore } from "@/store/printer-store";
import { getRetailerCartTotal, useRetailerCartStore } from "@/store/retailer-cart-store";
import { BaseUnit } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";

type FormValues = { cashAmount: string; upiAmount: string };

export function RetailerCheckoutScreen({ navigation, route }: RetailerCheckoutScreenProps) {
  const { retailerId } = route.params;
  const { language, t } = useShopTranslation();
  const cartItems = useRetailerCartStore((s) => s.items);
  const resetRetailerCart = useRetailerCartStore((s) => s.resetCart);
  const preferredPrinter = usePrinterStore((s) => s.preferredPrinter);
  const [submitting, setSubmitting] = useState(false);
  const completedRef = useRef(false);
  const form = useForm<FormValues>({ defaultValues: { cashAmount: "", upiAmount: "" } });
  const { receiptImagePrintBridge, startReceiptHtmlPrintJob } = useReceiptImagePrintJob();
  const headerMenu = useShopHeaderMenu(navigation);

  useEffect(() => {
    if (cartItems.length === 0 && !completedRef.current) {
      navigation.replace("RetailerSelect");
    }
  }, [cartItems.length, navigation]);

  const totalAmount = useMemo(() => getRetailerCartTotal(cartItems), [cartItems]);
  const [cashAmount = "", upiAmount = ""] = useWatch({
    control: form.control,
    name: ["cashAmount", "upiAmount"],
  });
  const paid = money(cashAmount).plus(money(upiAmount));
  const balance = money(totalAmount).minus(paid);
  const canPrint = paid.greaterThan(0) && paid.lessThanOrEqualTo(money(totalAmount));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  const handleCheckout = useCallback(
    async (values: FormValues) => {
      if (!canPrint) return;
      if (!preferredPrinter) {
        Alert.alert(t("printer.selectPrinterFirstTitle"), t("printer.selectPrinterFirstMessage"));
        return;
      }
      setSubmitting(true);
      try {
        const payload = {
          retailer_id: retailerId,
          items: cartItems.map((item) => ({
            item_id: item.item_id,
            quantity:
              item.base_unit === BaseUnit.UNIT
                ? money(item.quantity).toFixed(0)
                : money(item.quantity).toString(),
          })),
          payment: {
            cash_amount: toMoneyString(values.cashAmount),
            upi_amount: toMoneyString(values.upiAmount),
          },
        };
        const preview = await previewRetailerSale(payload);
        const invoiceReceipt = preview.receipt ?? preview.receipts?.[0];
        if (!invoiceReceipt) {
          throw new Error("Preview receipt is unavailable");
        }
        await startReceiptHtmlPrintJob(
          [buildRetailerSaleInvoiceHtml(preview, invoiceReceipt, language)],
          preferredPrinter,
          language,
        );
        await commitRetailerSale({ ...payload, checkout_token: preview.checkout_token });
        completedRef.current = true;
        resetRetailerCart();
        navigation.replace("RetailerSelect");
      } catch (error) {
        Alert.alert(t("checkout.checkoutFailedTitle"), toApiError(error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [
      canPrint,
      cartItems,
      language,
      navigation,
      preferredPrinter,
      resetRetailerCart,
      retailerId,
      startReceiptHtmlPrintJob,
      t,
    ],
  );

  return (
    <Screen topInset={false}>
      <Card className="mb-4 gap-3">
        <SectionHeading title={t("billing.reviewBeforeCheckout")} />
        {cartItems.map((line) => {
            const lineTotal = money(line.price_per_unit).mul(money(line.quantity)).toFixed(2);
            const displayName = getLocalizedItemName(
              language,
              line.item_name,
              line.item_tamil_name,
            );
            return (
              <View
                key={line.item_id}
                className="flex-row items-center justify-between border-b border-border py-2 last:border-b-0"
              >
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="font-semibold text-ink" numberOfLines={2}>
                    {displayName}
                  </Text>
                  <Text className="text-sm text-muted">
                    {line.quantity} {formatUnit(line.base_unit)} × {formatCurrency(line.price_per_unit)}
                  </Text>
                </View>
                <Text className="font-semibold text-ink">{formatCurrency(lineTotal)}</Text>
              </View>
            );
          })}
          <View className="flex-row justify-between border-t border-border pt-3">
            <Text className="font-semibold text-ink">{t("billing.cartLiveTotal")}</Text>
            <Text className="text-lg font-bold text-ink">{formatCurrency(totalAmount)}</Text>
          </View>
        </Card>
        <Card className="gap-4">
          <SectionHeading
            title={t("retailers.checkoutTitle")}
            subtitle={t("retailers.checkoutSubtitle")}
          />
          <Controller
            control={form.control}
            name="cashAmount"
            render={({ field }) => (
              <TextField
                label={t("checkout.cashAmount")}
                keyboardType="decimal-pad"
                placeholder="0.00"
                suffix="Rs"
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
                placeholder="0.00"
                suffix="Rs"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
          <View className="gap-2 rounded-card border border-border bg-card p-4">
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">{t("common.paidAmount")}</Text>
              <Text className="font-semibold text-ink">{formatCurrency(paid.toFixed(2))}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">{t("retailers.balanceDue")}</Text>
              <Text className="text-lg font-bold text-ink">{formatCurrency(balance.toFixed(2))}</Text>
            </View>
            <StatusPill
              label={balance.isZero() ? t("checkout.paymentMatched") : t("retailers.partialAllowed")}
              tone={balance.isZero() ? "success" : "warning"}
            />
          </View>
          <Button
            label={canPrint ? t("action.printReceipt") : t("retailers.enterPayment")}
            onPress={form.handleSubmit(handleCheckout)}
            disabled={!canPrint}
            loading={submitting}
        />
      </Card>
      {receiptImagePrintBridge}
    </Screen>
  );
}
