import { memo } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { ShopTranslationKey, useShopTranslation } from "@/hooks/use-shop-translation";

type ShopHeaderActionsProps = {
  onLogout: () => void;
};

export const ShopHeaderActions = memo(function ShopHeaderActions({ onLogout }: ShopHeaderActionsProps) {
  const { language, t, toggleLanguage } = useShopTranslation();
  const translateLabel = language === "en" ? "TAMIL" : "EN";

  return (
    <View className="flex-row items-center gap-1">
      <Button
        label={translateLabel}
        onPress={toggleLanguage}
        variant="secondary"
        size="sm"
        className="min-h-10 min-w-[76px] px-2"
        textClassName="text-[11px] leading-6"
      />
      <Button
        label={t("action.logout")}
        onPress={onLogout}
        variant="secondary"
        size="sm"
        className="min-h-10 px-2.5"
        textClassName="text-[11px] leading-6"
      />
    </View>
  );
});

type ShopHeaderTitleProps = {
  titleKey: ShopTranslationKey;
};

export const ShopHeaderTitle = memo(function ShopHeaderTitle({ titleKey }: ShopHeaderTitleProps) {
  const { t } = useShopTranslation();

  return <Text className="text-base font-bold text-ink">{t(titleKey)}</Text>;
});
