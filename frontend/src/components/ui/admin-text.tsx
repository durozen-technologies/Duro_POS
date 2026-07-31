import { StyleSheet, Text as RNText, TextProps } from "react-native";

import { useAdminLanguageStore } from "@/store/admin-language-store";

export function AdminText({ style, ...props }: TextProps) {
  const isTamil = useAdminLanguageStore((state) => state.language === "ta");
  const flattenedStyle = StyleSheet.flatten(style) || {};
  const baseFontSize = (flattenedStyle as { fontSize?: number }).fontSize;

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
