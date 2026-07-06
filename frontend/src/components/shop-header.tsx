import { memo, type ComponentProps, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TouchableWithoutFeedback, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { Button } from "@/components/ui/button";
import { ShopTranslationKey, useShopTranslation } from "@/hooks/use-shop-translation";

type ShopHeaderActionsProps = {
  onLogout: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onInventory?: () => void;
  onExpenses?: () => void;
  onRetailers?: () => void;
  onBills?: () => void;
  onPrinter?: () => void;
};

export const ShopHeaderActions = memo(function ShopHeaderActions({
  onLogout,
  onRefresh,
  refreshing = false,
  onInventory,
  onExpenses,
  onRetailers,
  onBills,
  onPrinter,
}: ShopHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { language, t, toggleLanguage } = useShopTranslation();
  const translateLabel = language === "en" ? "TAMIL" : "EN";
  const refreshLabel = refreshing ? t("billing.refreshingPrices") : t("action.refreshBilling");

  function closeMenu() {
    setMenuOpen(false);
  }

  function handleMenuAction(action?: () => void) {
    closeMenu();
    action?.();
  }

  return (
    <View className="flex-row items-center gap-1">
      {onRefresh ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={refreshLabel}
          accessibilityState={{ busy: refreshing, disabled: refreshing }}
          disabled={refreshing}
          onPress={onRefresh}
          className={`min-h-10 w-10 items-center justify-center rounded-control border border-border bg-card ${
            refreshing ? "opacity-90" : ""
          }`}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#0F7642" />
          ) : (
            <MaterialCommunityIcons name="sync" size={18} color="#0F7642" />
          )}
        </Pressable>
      ) : null}
      <Button
        label={translateLabel}
        onPress={toggleLanguage}
        variant="secondary"
        size="sm"
        className="min-h-10 min-w-[76px] px-2"
        textClassName="text-[11px] leading-6"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Menu"
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen(true)}
        className="min-h-10 min-w-[70px] flex-row items-center justify-center gap-1 rounded-control border border-border bg-card px-2.5"
      >
        <MaterialCommunityIcons name="menu" size={18} color="#0F7642" />
        <Text className="text-[11px] font-semibold leading-6 text-ink">Menu</Text>
      </Pressable>

      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={closeMenu}>
        <TouchableWithoutFeedback onPress={closeMenu}>
          <View className="flex-1 bg-black/20">
            <TouchableWithoutFeedback>
              <View className="absolute right-5 top-16 w-[320px] overflow-hidden rounded-card border border-border bg-card shadow-float">
                <MenuItem
                  icon="warehouse"
                  label={t("inventory.title")}
                  onPress={() => handleMenuAction(onInventory)}
                />
                <MenuItem
                  icon="store-outline"
                  label={t("retailers.title")}
                  onPress={() => handleMenuAction(onRetailers)}
                />
                <MenuItem
                  icon="receipt-text-outline"
                  label={t("bills.title")}
                  onPress={() => handleMenuAction(onBills)}
                />
                <MenuItem
                  icon="cash-minus"
                  label={t("expenses.title")}
                  onPress={() => handleMenuAction(onExpenses)}
                />
                <MenuItem
                  icon="printer-outline"
                  label={t("header.printerSetup")}
                  onPress={() => handleMenuAction(onPrinter)}
                />
                <View className="border-t border-border p-4">
                  <Button label={t("action.logout")} onPress={() => handleMenuAction(onLogout)} variant="danger" />
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
});

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-16 flex-row items-center gap-4 border-b border-border/70 px-5"
    >
      <MaterialCommunityIcons name={icon} size={26} color="#0F7642" />
      <Text className="flex-1 text-lg font-bold text-ink">{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={26} color="#4B6356" />
    </Pressable>
  );
}

type ShopHeaderTitleProps = {
  titleKey: ShopTranslationKey;
  shopName?: string | null;
};

export const ShopHeaderTitle = memo(function ShopHeaderTitle({ titleKey, shopName }: ShopHeaderTitleProps) {
  const { t } = useShopTranslation();
  const displayShopName = shopName?.trim();

  return (
    <View className="min-w-0">
      {displayShopName ? (
        <>
          <Text className="max-w-[220px] text-lg font-bold leading-7 text-ink" numberOfLines={1}>
            {displayShopName}
          </Text>
          <Text className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted" numberOfLines={1}>
            {t(titleKey)}
          </Text>
        </>
      ) : (
        <Text className="text-lg font-bold leading-6 text-ink">{t(titleKey)}</Text>
      )}
    </View>
  );
});
