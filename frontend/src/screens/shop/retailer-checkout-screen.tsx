import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { Controller, useForm, useWatch } from "react-hook-form";

import { commitRetailerSale, fetchShopRetailerWallet, previewRetailerSale } from "@/api/retailer-sales";
import { buildRetailerSaleInvoiceHtml } from "@/api/retailer-receipts";
import { formatApiErrorMessage } from "@/api/client";
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
import { resolveWalletCreditAmount } from "@/utils/retailer-wallet";
import { ShopText as Text } from "@/components/ui/shop-text";

type FormValues = { cashAmount: string; upiAmount: string };

export function RetailerCheckoutScreen({ navigation, route }: RetailerCheckoutScreenProps) {
  const { retailerId } = route.params;
  const { language, t } = useShopTranslation();
  const cartItems = useRetailerCartStore((s) => s.items);
  const resetRetailerCart = useRetailerCartStore((s) => s.resetCart);
  const preferredPrinter = usePrinterStore((s) => s.preferredPrinter);
  const [submitting, setSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [outstandingBalance, setOutstandingBalance] = useState<string | null>(null);
  const [applyWalletCredit, setApplyWalletCredit] = useState(false);
  const completedRef = useRef(false);
  const form = useForm<FormValues>({
    defaultValues: { cashAmount: "", upiAmount: "" },
  });
  const { receiptImagePrintBridge, startReceiptHtmlPrintJob } = useReceiptImagePrintJob();
  const headerMenu = useShopHeaderMenu(navigation);
  const hasWalletCredit = walletBalance !== null && money(walletBalance).greaterThan(0);

  useEffect(() => {
    if (cartItems.length === 0 && !completedRef.current) {
      navigation.replace("RetailerSelect");
    }
  }, [cartItems.length, navigation]);

  useEffect(() => {
    void fetchShopRetailerWallet(retailerId)
      .then((wallet) => {
        setWalletBalance(wallet.credit_balance);
        setOutstandingBalance(
          wallet.outstanding_balance != null
            ? Number(wallet.outstanding_balance).toFixed(2)
            : null,
        );
        setApplyWalletCredit(money(wallet.credit_balance).greaterThan(0));
      })
      .catch(() => {
        setWalletBalance(null);
        setOutstandingBalance(null);
        setApplyWalletCredit(false);
      });
  }, [retailerId]);

  const totalAmount = useMemo(() => getRetailerCartTotal(cartItems), [cartItems]);
  const [cashAmount = "", upiAmount = ""] = useWatch({
    control: form.control,
    name: ["cashAmount", "upiAmount"],
  });
  const walletAmount = useMemo(
    () => resolveWalletCreditAmount(applyWalletCredit, walletBalance, totalAmount, cashAmount, upiAmount),
    [applyWalletCredit, walletBalance, totalAmount, cashAmount, upiAmount],
  );
  const paid = money(walletAmount).plus(money(cashAmount)).plus(money(upiAmount));
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
        const resolvedWallet = resolveWalletCreditAmount(
          applyWalletCredit,
          walletBalance,
          totalAmount,
          values.cashAmount,
          values.upiAmount,
        );
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
            wallet_amount: toMoneyString(resolvedWallet),
            cash_amount: toMoneyString(values.cashAmount),
            upi_amount: toMoneyString(values.upiAmount),
          },
          include_opening_balance: true,
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
        Alert.alert(t("checkout.checkoutFailedTitle"), formatApiErrorMessage(error));
      } finally {
        setSubmitting(false);
      }
    },
    [
      applyWalletCredit,
      canPrint,
      cartItems,
      language,
      navigation,
      preferredPrinter,
      resetRetailerCart,
      retailerId,
      startReceiptHtmlPrintJob,
      t,
      totalAmount,
      walletBalance,
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
          {outstandingBalance !== null && money(outstandingBalance).greaterThan(0) ? (
            <Text className="text-sm text-muted">
              {t("retailers.outstandingAvailable", {
                amount: formatCurrency(outstandingBalance),
              })}
            </Text>
          ) : null}
          {hasWalletCredit ? (
            <Pressable
              className="flex-row items-center justify-between rounded-card border border-border bg-card px-4 py-3"
              onPress={() => setApplyWalletCredit((current) => !current)}
            >
              <View className="mr-3 min-w-0 flex-1">
                <Text className="font-semibold text-ink">{t("retailers.applyWalletCredit")}</Text>
                <Text className="mt-1 text-sm text-muted">
                  {t("retailers.applyWalletCreditHint", {
                    amount: formatCurrency(walletBalance ?? "0"),
                  })}
                </Text>
                {applyWalletCredit && money(walletAmount).greaterThan(0) ? (
                  <Text className="mt-1 text-sm font-medium text-ink">
                    {t("retailers.walletApplied", { amount: formatCurrency(walletAmount) })}
                  </Text>
                ) : null}
              </View>
              <Switch value={applyWalletCredit} onValueChange={setApplyWalletCredit} />
            </Pressable>
          ) : null}
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
            {applyWalletCredit && money(walletAmount).greaterThan(0) ? (
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted">{t("retailers.walletAmount")}</Text>
                <Text className="font-semibold text-ink">{formatCurrency(walletAmount)}</Text>
              </View>
            ) : null}
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
