import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildRetailerStatementHtml } from "@/api/retailer-statements";
import { formatApiErrorMessage } from "@/api/client";
import { fetchAllAdminRetailerSales, fetchRetailerBalance } from "@/api/retailers";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import type { RetailerRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { shareStatementPdf } from "@/utils/share-statement-pdf";
import {
  buildRetailerBalanceStatementFilename,
  createStatementDateDraft,
  filterStatementSales,
  isValidStatementDateDraft,
  resolveStatementApiDates,
  type StatementDateDraft,
  type StatementDateScope,
} from "@/utils/retailer-statement";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { ChipButton, PrimaryButton } from "./admin-dashboard-primitives";

const DATE_MODE_OPTIONS: {
  key: StatementDateScope;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
}[] = [
  { key: "all", label: "All Bills", icon: "calendar-blank-outline" },
  { key: "single", label: "Single Date", icon: "calendar" },
  { key: "range", label: "Date Range", icon: "calendar-range" },
];

type AdminRetailerStatementModalProps = {
  visible: boolean;
  retailer: RetailerRead;
  palette: ThemePalette;
  onClose: () => void;
};

export const AdminRetailerStatementModal = memo(function AdminRetailerStatementModal({
  visible,
  retailer,
  palette,
  onClose,
}: AdminRetailerStatementModalProps) {
  const [draft, setDraft] = useState<StatementDateDraft>(() => createStatementDateDraft());
  const [calendarTarget, setCalendarTarget] = useState<"date" | "start" | "end" | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft(createStatementDateDraft());
      setCalendarTarget(null);
      setGenerating(false);
    }
  }, [visible]);

  const calendarColors = useMemo<CalendarPickerColors>(
    () => ({
      overlay: palette.overlay,
      card: palette.card,
      surface: palette.surfaceMuted,
      border: palette.border,
      textPrimary: palette.textPrimary,
      textSecondary: palette.textSecondary,
      textMuted: palette.textMuted,
      accent: palette.primary,
      accentSoft: palette.primarySoft,
      onAccent: palette.onPrimary,
    }),
    [palette],
  );

  const handleGenerate = useCallback(async () => {
    if (!isValidStatementDateDraft(draft)) {
      Alert.alert("Invalid dates", "Choose a valid date or date range.");
      return;
    }

    triggerHaptic();
    setGenerating(true);
    try {
      const apiDates = resolveStatementApiDates(
        draft.dateMode,
        draft.date,
        draft.startDate,
        draft.endDate,
      );
      const [sales, balance] = await Promise.all([
        fetchAllAdminRetailerSales({
          retailer_id: retailer.id,
          ...apiDates,
        }),
        fetchRetailerBalance(retailer.id),
      ]);

      const outstandingSales = filterStatementSales(sales);
      if (outstandingSales.length === 0) {
        Alert.alert(
          "No outstanding bills",
          "There are no bills with a balance due for the selected scope.",
        );
        return;
      }

      if (money(balance.outstanding_balance).lte(0)) {
        Alert.alert(
          "No outstanding balance",
          "This retailer has no outstanding balance to share.",
        );
        return;
      }

      const html = buildRetailerStatementHtml({
        retailer,
        sales: outstandingSales,
        outstandingBalance: balance.outstanding_balance,
        creditBalance: balance.credit_balance,
        dateScope: draft.dateMode,
        date: draft.date,
        startDate: draft.startDate,
        endDate: draft.endDate,
      });

      await shareStatementPdf(
        html,
        "Share statement",
        buildRetailerBalanceStatementFilename(retailer.name),
      );
      onClose();
    } catch (error) {
      Alert.alert("Share failed", formatApiErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }, [draft, onClose, retailer]);

  const calendarValue =
    calendarTarget === "start"
      ? draft.startDate
      : calendarTarget === "end"
        ? draft.endDate
        : draft.date;

  const handleCalendarSelect = useCallback(
    (value: string) => {
      if (calendarTarget === "start") {
        setDraft((current) => ({
          ...current,
          startDate: value,
          endDate: value > current.endDate ? value : current.endDate,
        }));
      } else if (calendarTarget === "end") {
        setDraft((current) => ({
          ...current,
          endDate: value,
          startDate: value < current.startDate ? value : current.startDate,
        }));
      } else {
        setDraft((current) => ({ ...current, date: value }));
      }
      setCalendarTarget(null);
    },
    [calendarTarget],
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[adminTypography.section, { color: palette.textPrimary }]}>
                Share Statement
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close statement modal"
                hitSlop={12}
                onPress={onClose}
              >
                <MaterialCommunityIcons name="close" size={22} color={palette.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[adminTypography.body, { color: palette.textPrimary }]}>
                {retailer.name}
              </Text>
              <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]}>
                Generate a PDF statement with outstanding bills only and share it.
              </Text>

              <Text style={[adminTypography.caption, styles.modalSectionLabel, { color: palette.textMuted }]}>
                Scope
              </Text>
              <View style={styles.dateModeRow}>
                {DATE_MODE_OPTIONS.map((option) => {
                  const active = draft.dateMode === option.key;
                  return (
                    <ChipButton
                      key={option.key}
                      label={option.label}
                      icon={option.icon}
                      active={active}
                      palette={palette}
                      onPress={() => setDraft((current) => ({ ...current, dateMode: option.key }))}
                    />
                  );
                })}
              </View>

              {draft.dateMode === "single" ? (
                <CalendarDateField
                  label="Bill date"
                  value={draft.date}
                  colors={calendarColors}
                  onPress={() => setCalendarTarget("date")}
                />
              ) : null}

              {draft.dateMode === "range" ? (
                <View style={styles.dateRangeRow}>
                  <View style={styles.dateRangeField}>
                    <CalendarDateField
                      label="From"
                      value={draft.startDate}
                      colors={calendarColors}
                      icon="calendar-start"
                      onPress={() => setCalendarTarget("start")}
                    />
                  </View>
                  <View style={styles.dateRangeField}>
                    <CalendarDateField
                      label="To"
                      value={draft.endDate}
                      colors={calendarColors}
                      icon="calendar-end"
                      onPress={() => setCalendarTarget("end")}
                    />
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={[styles.modalActions, { borderTopColor: palette.border }]}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                palette={palette}
                onPress={onClose}
                disabled={generating}
              />
              <PrimaryButton
                label="Generate & Share"
                palette={palette}
                loading={generating}
                disabled={generating}
                icon="file-pdf-box"
                onPress={() => void handleGenerate()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <CalendarDatePickerModal
        visible={calendarTarget !== null}
        title={
          calendarTarget === "start"
            ? "Range start"
            : calendarTarget === "end"
              ? "Range end"
              : "Bill date"
        }
        value={calendarValue}
        colors={calendarColors}
        onClose={() => setCalendarTarget(null)}
        onSelect={handleCalendarSelect}
      />
    </>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: adminSpacing.md,
  },
  modalCard: {
    borderRadius: adminRadii.card,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: "88%",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: adminSpacing.md,
    paddingTop: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
  },
  modalScroll: {
    maxHeight: 360,
  },
  modalScrollContent: {
    paddingHorizontal: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
    gap: adminSpacing.sm,
  },
  modalSectionLabel: {
    fontWeight: "700",
    marginTop: adminSpacing.xs,
  },
  dateModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: adminSpacing.xs,
  },
  dateRangeRow: {
    flexDirection: "row",
    gap: adminSpacing.sm,
  },
  dateRangeField: {
    flex: 1,
    minWidth: 0,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: adminSpacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: adminSpacing.sm,
  },
});
