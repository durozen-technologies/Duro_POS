import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { Controller, Control, useForm, useWatch } from "react-hook-form";

import { checkoutBill, patchBillReceiptStatus, previewBill } from "@/api/billing";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { ShopHeaderActions } from "@/components/shop-header";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import { CheckoutScreenProps } from "@/navigation/types";
import {
  getPrinterDeviceDetail,
  getSavedPrinterLabel,
} from "@/services/printer-service";
import { getCartTotal, useCartStore } from "@/store/cart-store";
import { usePrinterStore } from "@/store/printer-store";
import { BaseUnit } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";
import { ShopText as Text } from "@/components/ui/shop-text";

type CheckoutFormValues = {
  cashAmount: string;
  upiAmount: string;
};

type CheckoutPaymentStatusProps = {
  control: Control<CheckoutFormValues>;
  totalAmount: string;
  submitting: boolean;
  t: ReturnType<typeof useShopTranslation>["t"];
  onSubmit: () => void;
};

type CheckoutPrinterCardProps = {
  printerLabel: string | null;
  printerDetail: string | null;
  t: ReturnType<typeof useShopTranslation>["t"];
  onManagePrinter: () => void;
};

const CheckoutPrinterCard = memo(function CheckoutPrinterCard({
  printerLabel,
  printerDetail,
  t,
  onManagePrinter,
}: CheckoutPrinterCardProps) {
  const printerConfigured = Boolean(printerLabel);

  return (
    <View className="rounded-card border border-border bg-card p-4">
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("common.savedPrinter")}
        </Text>
        <StatusPill
          label={printerConfigured ? t("common.ready") : t("common.notConfigured")}
          tone={printerConfigured ? "success" : "warning"}
        />
      </View>
      <Text className="text-base font-semibold text-ink">
        {printerLabel ?? t("printer.noPrinterSavedYet")}
      </Text>
      <Text className="mt-2 text-sm leading-5 text-muted">
        {printerConfigured ? printerDetail : t("printer.savedPrinterHint")}
      </Text>
      <Button
        label={printerConfigured ? t("action.managePrinter") : t("action.setUpPrinter")}
        onPress={onManagePrinter}
        variant="secondary"
        className="mt-4 self-start min-w-[170px]"
      />
    </View>
  );
});

const CheckoutPaymentStatus = memo(function CheckoutPaymentStatus({
  control,
  totalAmount,
  submitting,
  t,
  onSubmit,
}: CheckoutPaymentStatusProps) {
  const [cashAmount = "", upiAmount = ""] = useWatch({
    control,
    name: ["cashAmount", "upiAmount"],
  });

  const paymentSummary = useMemo(() => {
    const total = money(totalAmount);
    const cash = money(cashAmount);
    const upi = money(upiAmount);
    const paid = cash.plus(upi);
    const balance = total.minus(paid);
    const exact = paid.equals(total) && total.greaterThan(0);
    const overpaid = paid.greaterThan(total);

    return {
      paidAmountText: formatCurrency(paid.toFixed(2)),
      balanceAmountText: formatCurrency(balance.toFixed(2)),
      isExact: exact,
      isOverpaid: overpaid,
    };
  }, [cashAmount, totalAmount, upiAmount]);

  return (
    <>
      <View className="rounded-card border border-border bg-card p-4">
        <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("checkout.receiptControl")}</Text>
          {paymentSummary.isExact ? (
            <StatusPill label={t("checkout.paymentMatched")} tone="success" />
          ) : paymentSummary.isOverpaid ? (
            <StatusPill label={t("checkout.overpaidLocked")} tone="danger" />
          ) : (
            <StatusPill label={t("checkout.pendingBalance")} tone="warning" />
          )}
        </View>
        <View className="gap-3">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm text-muted">{t("common.paidAmount")}</Text>
            <Text className="text-base font-semibold tabular-nums text-ink">{paymentSummary.paidAmountText}</Text>
          </View>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm text-muted">{t("common.balanceAmount")}</Text>
            <Text className="text-base font-semibold tabular-nums text-ink">{paymentSummary.balanceAmountText}</Text>
          </View>
          <Text className="text-sm leading-5 text-muted">
            {paymentSummary.isExact
              ? t("checkout.paymentMatchedDescription")
              : paymentSummary.isOverpaid
                ? t("checkout.overpaidDescription")
                : t("checkout.pendingBalanceDescription")}
          </Text>
        </View>
      </View>

      <Button
        label={paymentSummary.isExact ? t("action.completeCheckout") : t("action.receiptLocked")}
        onPress={onSubmit}
        disabled={!paymentSummary.isExact}
        loading={submitting}
      />
    </>
  );
});

export function CheckoutScreen({ navigation }: CheckoutScreenProps) {
  const { language, t } = useShopTranslation();
  const cartItems = useCartStore((state) => state.items);
  const resetCart = useCartStore((state) => state.resetCart);
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);
  const [submitting, setSubmitting] = useState(false);
  const checkoutCompletedRef = useRef(false);

  const form = useForm<CheckoutFormValues>({
    defaultValues: {
      cashAmount: "",
      upiAmount: "",
    },
  });

  useEffect(() => {
    if (cartItems.length === 0 && !checkoutCompletedRef.current) {
      navigation.replace("Billing");
    }
  }, [cartItems.length, navigation]);

  const totalAmount = useMemo(() => getCartTotal(cartItems), [cartItems]);
  const printerLabel = preferredPrinter ? getSavedPrinterLabel(preferredPrinter) : null;
  const printerDetail = preferredPrinter ? getPrinterDeviceDetail(preferredPrinter) : null;
  const { receiptImagePrintBridge, startReceiptImagePrintJob } = useReceiptImagePrintJob();

  const headerMenu = useShopHeaderMenu(navigation);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  async function handleCheckout(values: CheckoutFormValues) {
    const total = money(totalAmount);
    const paidAmount = money(values.cashAmount).plus(money(values.upiAmount));
    const isExact = paidAmount.equals(total) && total.greaterThan(0);

    if (!isExact) {
      return;
    }

    setSubmitting(true);
    try {
      const checkoutPayload = {
        items: cartItems.map((item) => ({
          item_id: item.item_id,
          quantity: item.base_unit === BaseUnit.UNIT ? money(item.quantity).toFixed(0) : money(item.quantity).toString(),
        })),
        payment: {
          cash_amount: toMoneyString(values.cashAmount),
          upi_amount: toMoneyString(values.upiAmount),
        },
      };
      const billPreview = await previewBill(checkoutPayload);
      const { bill: savedBill } = await checkoutBill({
        ...checkoutPayload,
        checkout_token: billPreview.checkout_token,
      });

      checkoutCompletedRef.current = true;
      resetCart();
      form.reset({
        cashAmount: "0",
        upiAmount: "0",
      });

      if (!preferredPrinter) {
        Alert.alert(
          t("checkout.billSavedTitle"),
          t("checkout.billSavedNoPrinterMessage"),
        );
        navigation.replace("Billing");
        return;
      }

      try {
        await startReceiptImagePrintJob([savedBill], preferredPrinter, language);
        await patchBillReceiptStatus(savedBill.id, { status: "printed" });
      } catch (error) {
        const printError =
          error instanceof Error ? error.message : t("checkout.unableToOpenPrinterMessage");
        try {
          await patchBillReceiptStatus(savedBill.id, {
            status: "failed",
            error: printError,
          });
        } catch {
          // Bill is saved; receipt status patch is best-effort.
        }
        Alert.alert(t("checkout.printFailedAfterSaveTitle"), t("checkout.printFailedAfterSaveMessage"));
      }

      navigation.replace("Billing");
    } catch (error) {
      Alert.alert(t("checkout.checkoutFailedTitle"), formatApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen topInset={false} contentTopPadding={4}>
      <Card className="gap-4">
        <SectionHeading
          title={t("checkout.enterPaymentAmounts")}
          subtitle={t("checkout.enterPaymentAmountsSubtitle")}
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
        {!printerLabel ? (
          <CheckoutPrinterCard
            printerLabel={printerLabel}
            printerDetail={printerDetail}
            t={t}
            onManagePrinter={() => navigation.navigate("PrinterSetup")}
          />
        ) : null}

        <CheckoutPaymentStatus
          control={form.control}
          totalAmount={totalAmount}
          submitting={submitting}
          t={t}
          onSubmit={form.handleSubmit(handleCheckout)}
        />
      </Card>
      {receiptImagePrintBridge}
    </Screen>
  );
}
