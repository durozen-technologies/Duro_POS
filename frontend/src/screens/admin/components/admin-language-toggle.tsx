import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAdminTranslation } from "@/hooks/use-admin-translation";
import type { AdminLanguage } from "@/store/admin-language-store";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

type AdminLanguageToggleProps = {
  palette: ThemePalette;
  compact?: boolean;
};

const LANGUAGE_OPTIONS: { value: AdminLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ta", label: "Tamil" },
];

export function AdminLanguageToggle({ palette, compact = false }: AdminLanguageToggleProps) {
  const { language, setLanguage } = useAdminTranslation();

  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.control,
        compact && styles.controlCompact,
        {
          backgroundColor: palette.primarySoft,
          borderColor: palette.primary,
        },
      ]}
    >
      {LANGUAGE_OPTIONS.map((option) => {
        const selected = language === option.value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) {
                return;
              }
              triggerHaptic();
              setLanguage(option.value);
            }}
            style={[
              styles.button,
              compact && styles.buttonCompact,
              {
                backgroundColor: selected ? palette.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                compact && styles.labelCompact,
                { color: selected ? palette.onPrimary : palette.primaryStrong },
              ]}
            >
              {option.label}
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
    marginRight: 10,
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
});
