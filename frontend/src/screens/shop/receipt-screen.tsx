import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, InteractionManager, Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { CommonActions } from "@react-navigation/native";
import { buildReceiptHtml } from "@/api/receipts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import { ReceiptScreenProps } from "@/navigation/types";
import { useReceiptStore } from "@/store/receipt-store";
import { formatCurrency, formatDateTime, formatUnit } from "@/utils/format";

export function ReceiptScreen({ navigation, route }: ReceiptScreenProps) {
  const { t, translateItemName } = useShopTranslation();
  const insets = useSafeAreaInsets();
  const lastBill = useReceiptStore((state) => state.lastBill);
  const clearLastBill = useReceiptStore((state) => state.clearLastBill);
  const bill = route.params?.bill ?? lastBill;
  const [printing, setPrinting] = useState(false);
  const [receiptPreviewHeight, setReceiptPreviewHeight] = useState(320);
  const [showPreview, setShowPreview] = useState(false);

  function handleNextBill() {
    clearLastBill();
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "Billing" }],
      }),
    );
  }

  const receiptHtml = useMemo(() => (bill ? buildReceiptHtml(bill) : ""), [bill]);
  const receiptPreviewScript = useMemo(
    () => `
      (function() {
        function postHeight() {
          var receipt = document.querySelector('.receipt-container');
          var receiptHeight = receipt ? receipt.getBoundingClientRect().height : 0;
          var bodyHeight = document.body ? document.body.getBoundingClientRect().height : 0;
          var height = Math.ceil(Math.max(receiptHeight, bodyHeight));
          window.ReactNativeWebView.postMessage(String(height));
        }

        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';

        if (document.body) {
          document.body.style.margin = '0';
          document.body.style.overflow = 'hidden';
        }

        window.addEventListener('load', postHeight);
        window.addEventListener('resize', postHeight);
        setTimeout(postHeight, 60);
        setTimeout(postHeight, 180);
      })();
      true;
    `,
    [],
  );

  useEffect(() => {
    setShowPreview(false);
    const task = InteractionManager.runAfterInteractions(() => {
      setShowPreview(true);
    });

    return () => {
      task.cancel();
    };
  }, [bill?.id]);

  async function handlePrintReceipt() {
    if (!bill) {
      return;
    }

    try {
      setPrinting(true);
      await Linking.openURL(`printerapp://print?html=${encodeURIComponent(receiptHtml)}`);
    } catch {
      Alert.alert(t("checkout.unableToOpenPrinterTitle"), t("checkout.unableToOpenPrinterMessage"));
    } finally {
      setPrinting(false);
    }
  }

  if (!bill) {
    return (
      <Screen>
        <Card className="gap-4">
          <SectionHeading
            eyebrow={t("receipt.missingEyebrow")}
            title={t("receipt.missingTitle")}
            subtitle={t("receipt.missingSubtitle")}
          />
          <Button label={t("action.backToBilling")} onPress={handleNextBill} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View className="flex-1 gap-4">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 20, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Card className="gap-5 overflow-hidden bg-card p-0">
            <View className="rounded-[30px] bg-accent px-5 py-5">
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View className="flex-1 gap-2">
                  <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-white/75">
                    {t("receipt.completeEyebrow")}
                  </Text>
                  <Text className="text-[30px] font-bold text-white">{t("receipt.completeTitle")}</Text>
                  <Text className="text-sm leading-6 text-white/85">{t("receipt.completeSubtitle")}</Text>
                </View>
                <StatusPill label={bill.payment.is_settled ? "PAID" : bill.status} tone="success" />
              </View>
            </View>

            <View className="flex-row flex-wrap gap-3 px-5">
              <View className="min-w-[150px] flex-1 rounded-[24px] bg-surface px-4 py-4">
                <Text className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted">{t("receipt.shop")}</Text>
                <Text className="mt-1 text-base font-semibold text-ink">{bill.shop_name}</Text>
                <Text className="mt-1 text-xs text-muted">{bill.bill_no}</Text>
              </View>
              <View className="min-w-[150px] flex-1 rounded-[24px] bg-surface px-4 py-4">
                <Text className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted">
                  {t("receipt.totalCollected")}
                </Text>
                <Text className="mt-1 text-2xl font-bold text-ink">{formatCurrency(bill.total_amount)}</Text>
                <Text className="mt-1 text-xs text-muted">{formatDateTime(bill.created_at)}</Text>
              </View>
            </View>

            <View className="flex-row flex-wrap items-start justify-between gap-3 px-5">
              <Text className="text-lg font-semibold text-ink">{t("receipt.purchasedItems")}</Text>
              <Text className="text-sm text-muted">{t("receipt.lineItems", { count: bill.items.length })}</Text>
            </View>

            {bill.items.map((item) => (
              <View
                key={item.item_id}
                className="mx-5 flex-row flex-wrap items-start justify-between gap-3 rounded-[22px] bg-surface px-4 py-4"
              >
                <View className="flex-1 gap-1">
                  <Text className="text-sm font-semibold text-ink">{translateItemName(item.item_name)}</Text>
                  <Text className="text-xs leading-5 text-muted">
                    {item.quantity} {formatUnit(item.unit)} x {formatCurrency(item.price_per_unit)}
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-ink">{formatCurrency(item.line_total)}</Text>
              </View>
            ))}

            <View className="gap-3 px-5 pb-5">
              <View className="gap-2 rounded-[24px] bg-surface p-4">
                <Text className="text-sm font-semibold text-ink">{t("receipt.summaryTitle")}</Text>
                <View className="flex-row flex-wrap justify-between gap-2">
                  <Text className="text-sm text-muted">{t("common.totalAmount")}</Text>
                  <Text className="text-sm font-semibold text-ink">{formatCurrency(bill.total_amount)}</Text>
                </View>
                <View className="flex-row flex-wrap justify-between gap-2">
                  <Text className="text-sm text-muted">{t("checkout.cashAmount")}</Text>
                  <Text className="text-sm font-semibold text-ink">{formatCurrency(bill.payment.cash_amount)}</Text>
                </View>
                <View className="flex-row flex-wrap justify-between gap-2">
                  <Text className="text-sm text-muted">{t("checkout.upiAmount")}</Text>
                  <Text className="text-sm font-semibold text-ink">{formatCurrency(bill.payment.upi_amount)}</Text>
                </View>
              </View>
            </View>
          </Card>

          <Card className="gap-4">
            <SectionHeading
              eyebrow={t("receipt.previewEyebrow")}
              title={t("receipt.previewTitle")}
              subtitle={t("receipt.previewSubtitle")}
            />
            <View className="rounded-[28px] bg-surface p-2">
              <View className="w-full self-center overflow-hidden rounded-[20px] border border-black bg-white shadow-soft">
                {showPreview ? (
                  <WebView
                    originWhitelist={["*"]}
                    source={{ html: receiptHtml }}
                    injectedJavaScript={receiptPreviewScript}
                    onMessage={(event) => {
                      const nextHeight = Number(event.nativeEvent.data);
                      if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
                        return;
                      }

                      setReceiptPreviewHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
                    }}
                    scrollEnabled={false}
                    nestedScrollEnabled={false}
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    style={{ width: "100%", height: receiptPreviewHeight, backgroundColor: "transparent" }}
                  />
                ) : (
                  <View className="items-center justify-center py-12">
                    <ActivityIndicator color="#244734" />
                    <Text className="mt-3 text-sm text-muted">{t("receipt.previewTitle")}</Text>
                  </View>
                )}
              </View>
            </View>
          </Card>
        </ScrollView>
        <View
          className="gap-3 rounded-[28px] border border-border/80 bg-card px-3 pt-3 shadow-soft"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
          <Button label={t("action.printReceipt")} onPress={() => void handlePrintReceipt()} loading={printing} />
          <Button label={t("action.startNextBill")} onPress={handleNextBill} variant="secondary" />
        </View>
      </View>
    </Screen>
  );
}
