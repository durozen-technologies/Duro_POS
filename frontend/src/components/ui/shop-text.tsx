import { StyleSheet, Text as RNText, TextProps } from "react-native";
import { useShopLanguageStore } from "@/store/shop-language-store";

export function ShopText({ style, ...props }: TextProps) {
  const isTamil = useShopLanguageStore((state) => state.language === "ta");

  const flattenedStyle = StyleSheet.flatten(style) || {};
  const baseFontSize = (flattenedStyle as any).fontSize;

  return (
    <RNText
      {...props}
      style={[
        style,
        isTamil && {
          fontFamily: "NotoSansTamil",
          fontSize: (baseFontSize || 14) * 0.78,
        },
      ]}
    />
  );
}