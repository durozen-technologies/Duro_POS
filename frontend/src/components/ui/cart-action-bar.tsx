import { useEffect, useState } from "react";
import { Keyboard, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import { cn } from "@/utils/cn";

type CartActionBarProps = {
  total: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  hideWhenKeyboardVisible?: boolean;
};

export function CartActionBar({
  total,
  disabled,
  label,
  onPress,
  hideWhenKeyboardVisible = false,
}: CartActionBarProps) {
  const insets = useSafeAreaInsets();
  const { isTamil, t } = useShopTranslation();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (!hideWhenKeyboardVisible) {
      return undefined;
    }

    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [hideWhenKeyboardVisible]);

  if (hideWhenKeyboardVisible && isKeyboardVisible) {
    return null;
  }

  return (
    <View className="absolute bottom-0 left-0 right-0 px-4" style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}>
      <View className="w-full max-w-[768px] self-center">
        <View className="rounded-card border border-border bg-card px-4 pb-4 pt-4 shadow-float">
          <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
            <View>
              <Text
                className={cn(
                  "font-semibold text-muted",
                  isTamil ? "text-xs leading-5 tracking-[0px]" : "text-[11px] uppercase tracking-[1.8px]",
                )}
              >
                {t("billing.cartLiveTotal")}
              </Text>
              <Text className={cn("mt-1 text-xs text-muted", isTamil && "leading-5")}>
                {disabled ? t("billing.cartUnlockCheckout") : t("billing.cartReadyForPaymentReview")}
              </Text>
            </View>
            <Text className="text-[30px] font-bold tabular-nums text-ink">{total}</Text>
          </View>
          <Button label={label} onPress={onPress} disabled={disabled} />
        </View>
      </View>
    </View>
  );
}
