import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAdminTranslation } from "@/hooks/use-admin-translation";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

type AdminLanguageToggleProps = {
  palette: ThemePalette;
  compact?: boolean;
};

export function AdminLanguageToggle({ palette, compact = false }: AdminLanguageToggleProps) {
  const { language, setLanguage, t } = useAdminTranslation();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.control,
        compact && styles.controlCompact,
        {
          backgroundColor: palette.shellControl,
          borderColor: palette.shellBorder,
        },
      ]}
    >
      {(["en", "ta"] as const).map((nextLanguage) => {
        const selected = language === nextLanguage;
        const label =
          nextLanguage === "en" ? t("action.translateToEnglish") : t("action.translateToTamil");
        const accessibilityLabel =
          nextLanguage === "en" ? t("a11y.languageEnglish") : t("a11y.languageTamil");

        return (
          <Pressable
            key={nextLanguage}
            accessibilityRole="tab"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected }}
            onPress={() => {
              triggerHaptic();
              setLanguage(nextLanguage);
            }}
            style={[
              styles.button,
              compact && styles.buttonCompact,
              {
                backgroundColor: selected ? palette.primary : "transparent",
                borderColor: selected ? palette.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                compact && styles.labelCompact,
                nextLanguage === "ta" && styles.tamilLabel,
                { color: selected ? palette.onPrimary : palette.onShellMuted },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: 34,
    borderRadius: adminRadii.control,
    borderWidth: 1,
    padding: 2,
    flexDirection: "row",
    gap: 2,
  },
  controlCompact: {
    minHeight: 32,
  },
  button: {
    minHeight: 28,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: adminSpacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: {
    minHeight: 26,
    paddingHorizontal: 8,
  },
  label: {
    ...adminTypography.badge,
    textTransform: "none",
  },
  labelCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
  tamilLabel: {
    fontFamily: "NotoSansTamil",
    fontSize: 10,
  },
});
