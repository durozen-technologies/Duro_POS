import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { fetchAdminInventoryBackdatePolicy, updateAdminInventoryBackdatePolicy } from "@/api/inventory";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { AdminText as Text } from "@/components/ui/admin-text";
import { useAdminTranslation } from "@/hooks/use-admin-translation";
import type { InventoryBackdatePolicyRead } from "@/types/api";

import { type ThemePalette } from "../admin-dashboard-theme";

function getRequestMessage(error: unknown, fallback: string) {
  return formatApiErrorMessage(error, fallback);
}

const BACKDATE_WINDOW_OPTIONS = [
  { value: 0, labelKey: "settings.backdateTodayOnly", subtitleKey: "settings.backdateNoPastDates" },
  { value: 1, labelKey: "settings.backdateOneDay", subtitleKey: "settings.backdateYesterdayThroughToday" },
  { value: 3, labelKey: "settings.backdateThreeDays", subtitleKey: "settings.backdateUpToThreeDays" },
  { value: 7, labelKey: "settings.backdateSevenDays", subtitleKey: "settings.backdateUpToOneWeek" },
  { value: 30, labelKey: "settings.backdateThirtyDays", subtitleKey: "settings.backdateUpToOneMonth" },
] as const;

function windowLabel(
  days: number | null | undefined,
  options: Array<{ value: number; label: string }>,
) {
  return options.find((option) => option.value === (days ?? 0))?.label ?? `${days ?? 0} days`;
}

type ShopBackdatingPolicySectionProps = {
  palette: ThemePalette;
};

export function ShopBackdatingPolicySection({ palette }: ShopBackdatingPolicySectionProps) {
  const { t } = useAdminTranslation();
  const [policy, setPolicy] = useState<InventoryBackdatePolicyRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [windowPickerOpen, setWindowPickerOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const backdateWindowOptions = BACKDATE_WINDOW_OPTIONS.map((option) => ({
    ...option,
    label: t(option.labelKey),
    subtitle: t(option.subtitleKey),
  }));

  const loadPolicy = useCallback(async () => {
    setErrorMessage(null);
    try {
      const nextPolicy = await fetchAdminInventoryBackdatePolicy();
      setPolicy(nextPolicy);
    } catch (error) {
      setErrorMessage(getRequestMessage(error, t("settings.backdateLoadError")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const persistPolicy = useCallback(
    async (allow: boolean, windowDays: number) => {
      if (saving) {
        return;
      }
      if (allow && windowDays < 0) {
        setValidationError(t("settings.backdateWindowRequired"));
        return;
      }
      setValidationError(null);
      setSaving(true);
      setErrorMessage(null);
      try {
        const updated = await updateAdminInventoryBackdatePolicy({
          allow_shop_backdated_inventory: allow,
          shop_backdate_window_days: allow ? windowDays : 0,
        });
        setPolicy(updated);
      } catch (error) {
        setErrorMessage(getRequestMessage(error, t("settings.backdateSaveError")));
      } finally {
        setSaving(false);
      }
    },
    [saving, t],
  );

  const enabled = policy?.allow_shop_backdated_inventory ?? false;
  const windowDays = policy?.shop_backdate_window_days ?? 0;

  const handleToggle = (nextEnabled: boolean) => {
    if (!policy || saving) {
      return;
    }
    if (nextEnabled) {
      void persistPolicy(true, windowDays > 0 ? windowDays : 1);
      return;
    }
    setWindowPickerOpen(false);
    void persistPolicy(false, 0);
  };

  const handleSelectWindow = (days: number) => {
    setWindowPickerOpen(false);
    void persistPolicy(true, days);
  };

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: palette.inventorySoft }]}>
          <MaterialCommunityIcons name="calendar-clock-outline" size={20} color={palette.inventory} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>{t("settings.shopBackdating")}</Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            {t("settings.shopBackdatingHint")}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.inventory} />
          <Text style={[styles.loadingText, { color: palette.textMuted }]}>{t("settings.loadingSettings")}</Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.toggleRow,
              {
                borderColor: enabled ? palette.inventory : palette.border,
                backgroundColor: enabled ? palette.inventorySoft : palette.surfaceMuted,
              },
            ]}
          >
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleLabel, { color: palette.textPrimary }]}>
                {enabled ? t("settings.enabledForBranches") : t("settings.disabledForBranches")}
              </Text>
              <Text style={[styles.toggleHint, { color: palette.textMuted }]}>
                {enabled ? t("settings.backdateEnabledHint") : t("settings.backdateDisabledHint")}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t("settings.shopBackdating")}
              accessibilityHint={t("settings.shopBackdatingA11yHint")}
              value={enabled}
              disabled={saving || !policy}
              onValueChange={handleToggle}
              trackColor={{ false: palette.border, true: palette.inventory }}
              thumbColor={palette.background}
            />
          </View>

          {enabled ? (
            <View style={styles.dropdownWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("settings.selectBackdatingWindow")}
                accessibilityState={{ expanded: windowPickerOpen }}
                disabled={saving}
                onPress={() => setWindowPickerOpen(true)}
                style={[
                  styles.dropdownSelect,
                  {
                    borderColor: validationError ? palette.danger : palette.border,
                    backgroundColor: palette.surfaceMuted,
                    opacity: saving ? 0.72 : 1,
                  },
                ]}
              >
                <View style={styles.dropdownTextWrap}>
                  <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>{t("settings.backdatingWindow")}</Text>
                  <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
                    {windowLabel(windowDays, backdateWindowOptions)}
                  </Text>
                </View>
                {saving ? (
                  <ActivityIndicator color={palette.inventory} />
                ) : (
                  <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
                )}
              </Pressable>
              {validationError ? (
                <Text style={[styles.inlineError, { color: palette.danger }]}>{validationError}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {errorMessage ? (
        <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}

      <Modal visible={windowPickerOpen} transparent animationType="fade" onRequestClose={() => setWindowPickerOpen(false)}>
        <View style={[styles.dropdownOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setWindowPickerOpen(false)} />
          <View style={[styles.dropdownSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.dropdownSheetHeader}>
              <Text style={[styles.dropdownSheetTitle, { color: palette.textPrimary }]}>{t("settings.backdatingWindow")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("a11y.closeBackdatingWindowPicker")}
                onPress={() => setWindowPickerOpen(false)}
                style={styles.dropdownClose}
              >
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.dropdownOptionList}>
              {backdateWindowOptions.map((option) => {
                const selected = windowDays === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => handleSelectWindow(option.value)}
                    style={[
                      styles.dropdownOption,
                      {
                        borderColor: selected ? palette.inventory : palette.border,
                        backgroundColor: selected ? palette.inventorySoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <View style={styles.dropdownOptionTextWrap}>
                      <Text style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>{option.label}</Text>
                      <Text style={[styles.dropdownOptionSubtext, { color: palette.textMuted }]}>{option.subtitle}</Text>
                    </View>
                    {selected ? (
                      <MaterialCommunityIcons name="check-circle" size={18} color={palette.inventory} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
  },
  copy: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: "600",
  },
  toggleRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "800",
  },
  toggleHint: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  dropdownWrap: {
    gap: 6,
  },
  dropdownSelect: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dropdownTextWrap: {
    flex: 1,
    gap: 2,
  },
  dropdownLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  dropdownValue: {
    fontSize: 15,
    fontWeight: "700",
  },
  inlineError: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  dropdownOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  dropdownSheet: {
    maxHeight: "72%",
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  dropdownSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownSheetTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  dropdownClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownOptionList: {
    padding: 12,
    gap: 8,
  },
  dropdownOption: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  dropdownOptionTextWrap: {
    flex: 1,
    gap: 2,
  },
  dropdownOptionText: {
    fontSize: 14,
    fontWeight: "800",
  },
  dropdownOptionSubtext: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
});
