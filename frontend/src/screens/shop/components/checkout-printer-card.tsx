import { memo } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ShopText as Text } from "@/components/ui/shop-text";
import type { useShopTranslation } from "@/hooks/use-shop-translation";
import type { PrinterConnectionStatus } from "@/store/printer-store";

type CheckoutPrinterCardProps = {
  printerLabel: string | null;
  printerDetail: string | null;
  connectionStatus: PrinterConnectionStatus;
  t: ReturnType<typeof useShopTranslation>["t"];
  onManagePrinter: () => void;
};

export const CheckoutPrinterCard = memo(function CheckoutPrinterCard({
  printerLabel,
  printerDetail,
  connectionStatus,
  t,
  onManagePrinter,
}: CheckoutPrinterCardProps) {
  const printerConfigured = Boolean(printerLabel);
  const isReady = printerConfigured && connectionStatus === "ready";
  const isFailed = printerConfigured && connectionStatus === "failed";

  const statusLabel = !printerConfigured
    ? t("common.notConfigured")
    : isReady
      ? t("common.ready")
      : isFailed
        ? t("printer.connectionFailedStatus")
        : t("printer.savedNotConnectedStatus");

  const title = printerLabel ?? t("printer.noPrinterSavedYet");

  const description = !printerConfigured
    ? t("printer.savedPrinterHint")
    : isReady
      ? printerDetail
      : isFailed
        ? t("printer.connectionFailedMessage", {
            deviceName: printerLabel ?? t("common.savedPrinter"),
          })
        : t("printer.savedNotConnectedMessage", {
            deviceName: printerLabel ?? t("common.savedPrinter"),
          });

  return (
    <View className="rounded-card border border-border bg-card p-4">
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("common.savedPrinter")}
        </Text>
        <StatusPill label={statusLabel} tone={isReady ? "success" : "warning"} />
      </View>
      <Text className="text-base font-semibold text-ink">{title}</Text>
      <Text className="mt-2 text-sm leading-5 text-muted">{description}</Text>
      <Button
        label={isReady ? t("action.managePrinter") : t("action.setUpPrinter")}
        onPress={onManagePrinter}
        variant="secondary"
        className="mt-4 self-start min-w-[170px]"
      />
    </View>
  );
});
