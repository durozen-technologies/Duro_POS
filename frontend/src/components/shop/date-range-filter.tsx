import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  CalendarDateField,
  CalendarDatePickerModal,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { appTheme } from "@/constants/theme";
import type { ShopTranslationKey } from "@/hooks/use-shop-translation";
import {
  EXPENSE_HISTORY_INTERVAL_OPTIONS,
  type ExpenseHistoryFilterDraft,
  type ExpenseHistoryInterval,
  type ExpenseHistoryRange,
} from "@/utils/expense-history-filters";

export const SHOP_CALENDAR_COLORS: CalendarPickerColors = {
  overlay: "rgba(30,43,34,0.38)",
  card: appTheme.card,
  surface: appTheme.background,
  border: appTheme.border,
  textPrimary: appTheme.text,
  textSecondary: "#4B5C50",
  textMuted: appTheme.muted,
  accent: appTheme.accent,
  accentSoft: appTheme.accentSoft,
  onAccent: "#FFFFFF",
};

type CalendarTarget = "date" | "startDate" | "endDate" | "weekDate";

type ShopDateRangeFilterProps = {
  filter: ExpenseHistoryFilterDraft;
  range: ExpenseHistoryRange;
  onChange: (filter: ExpenseHistoryFilterDraft) => void;
  t: (key: ShopTranslationKey, params?: Record<string, string>) => string;
  footer?: ReactNode;
};

const INTERVAL_LABEL_KEYS: Record<ExpenseHistoryInterval, ShopTranslationKey> = {
  today: "bills.intervalToday",
  date: "bills.intervalDate",
  range: "bills.intervalRange",
  week: "bills.intervalWeek",
  month: "bills.intervalMonth",
  year: "bills.intervalYear",
  all: "bills.intervalAll",
};

const styles = StyleSheet.create({
  card: {
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 14,
  },
  intervalButton: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.background,
    paddingHorizontal: 12,
  },
  intervalIconWrap: {
    height: 40,
    width: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: appTheme.accentSoft,
  },
  rangeSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.accent,
    backgroundColor: appTheme.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rangeSummaryInvalid: {
    borderColor: appTheme.danger,
    backgroundColor: appTheme.dangerSoft,
  },
  textInputWrap: {
    gap: 6,
    flex: 1,
    minWidth: 140,
  },
  textInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.background,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: "600",
    color: appTheme.text,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: SHOP_CALENDAR_COLORS.overlay,
  },
  modalCard: {
    maxHeight: "82%",
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    padding: 16,
  },
  optionRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
});

function ShopDateTextInput({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.textInputWrap}>
      <Text className="text-xs font-semibold text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={appTheme.muted}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        style={styles.textInput}
      />
    </View>
  );
}

export const ShopDateRangeFilter = memo(function ShopDateRangeFilter({
  filter,
  range,
  onChange,
  t,
  footer,
}: ShopDateRangeFilterProps) {
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget | null>(null);

  const selectedOption =
    EXPENSE_HISTORY_INTERVAL_OPTIONS.find((option) => option.key === filter.interval)
    ?? EXPENSE_HISTORY_INTERVAL_OPTIONS[0];

  const updateFilter = (patch: Partial<ExpenseHistoryFilterDraft>) => onChange({ ...filter, ...patch });

  const calendarValue = useMemo(() => {
    if (calendarTarget === "date") return filter.date;
    if (calendarTarget === "startDate") return filter.startDate;
    if (calendarTarget === "endDate") return filter.endDate;
    if (calendarTarget === "weekDate") return filter.weekDate;
    return null;
  }, [calendarTarget, filter.date, filter.endDate, filter.startDate, filter.weekDate]);

  const calendarTitle = useMemo(() => {
    if (calendarTarget === "date") return t("bills.selectDate");
    if (calendarTarget === "startDate") return t("bills.selectStartDate");
    if (calendarTarget === "endDate") return t("bills.selectEndDate");
    if (calendarTarget === "weekDate") return t("bills.selectWeekDate");
    return t("bills.selectDate");
  }, [calendarTarget, t]);

  const selectCalendarDate = (date: string) => {
    if (calendarTarget === "date") {
      updateFilter({ date });
    } else if (calendarTarget === "startDate") {
      updateFilter({ startDate: date });
    } else if (calendarTarget === "endDate") {
      updateFilter({ endDate: date });
    } else if (calendarTarget === "weekDate") {
      updateFilter({ weekDate: date });
    }
    setCalendarTarget(null);
  };

  const intervalInput = (() => {
    if (filter.interval === "date") {
      return (
        <CalendarDateField
          label={t("bills.dateLabel")}
          value={filter.date}
          colors={SHOP_CALENDAR_COLORS}
          onPress={() => setCalendarTarget("date")}
        />
      );
    }
    if (filter.interval === "range") {
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 148 }}>
            <CalendarDateField
              label={t("bills.fromDate")}
              value={filter.startDate}
              colors={SHOP_CALENDAR_COLORS}
              icon="calendar-start"
              onPress={() => setCalendarTarget("startDate")}
            />
          </View>
          <View style={{ flex: 1, minWidth: 148 }}>
            <CalendarDateField
              label={t("bills.toDate")}
              value={filter.endDate}
              colors={SHOP_CALENDAR_COLORS}
              icon="calendar-end"
              onPress={() => setCalendarTarget("endDate")}
            />
          </View>
        </View>
      );
    }
    if (filter.interval === "week") {
      return (
        <CalendarDateField
          label={t("bills.weekDate")}
          value={filter.weekDate}
          colors={SHOP_CALENDAR_COLORS}
          icon="calendar-week"
          onPress={() => setCalendarTarget("weekDate")}
        />
      );
    }
    if (filter.interval === "month") {
      return (
        <ShopDateTextInput
          label={t("bills.monthLabel")}
          value={filter.month}
          placeholder="YYYY-MM"
          onChangeText={(month) => updateFilter({ month })}
        />
      );
    }
    if (filter.interval === "year") {
      return (
        <ShopDateTextInput
          label={t("bills.yearLabel")}
          value={filter.year}
          placeholder="YYYY"
          onChangeText={(year) => updateFilter({ year })}
        />
      );
    }
    return null;
  })();

  return (
    <View style={styles.card}>
      <Text className="text-base font-bold text-ink">{t("bills.dateFilterTitle")}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("bills.selectInterval")}
        onPress={() => setIntervalOpen(true)}
        style={styles.intervalButton}
      >
        <View style={styles.intervalIconWrap}>
          <MaterialCommunityIcons
            name={selectedOption.icon as ComponentProps<typeof MaterialCommunityIcons>["name"]}
            size={20}
            color={appTheme.accent}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-xs font-semibold text-muted">{t("bills.selectInterval")}</Text>
          <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>
            {t(INTERVAL_LABEL_KEYS[filter.interval])}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={appTheme.muted} />
      </Pressable>

      {intervalInput}

      <View style={[styles.rangeSummary, !range.isValid ? styles.rangeSummaryInvalid : null]}>
        <MaterialCommunityIcons
          name={range.isValid ? "calendar-check" : "alert-circle-outline"}
          size={20}
          color={range.isValid ? appTheme.accent : appTheme.danger}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-sm font-bold text-ink" numberOfLines={2}>
            {range.isValid ? range.label : t("bills.invalidDateRange")}
          </Text>
          {!range.isValid && range.validationMessage ? (
            <Text className="mt-0.5 text-xs font-semibold text-danger">{range.validationMessage}</Text>
          ) : null}
        </View>
      </View>

      {footer}

      <Modal visible={intervalOpen} transparent animationType="fade" onRequestClose={() => setIntervalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIntervalOpen(false)} />
          <View style={styles.modalCard}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text className="text-lg font-bold text-ink">{t("bills.selectInterval")}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("action.cancel")}
                onPress={() => setIntervalOpen(false)}
                className="h-10 w-10 items-center justify-center"
              >
                <MaterialCommunityIcons name="close" size={20} color={appTheme.text} />
              </Pressable>
            </View>
            {EXPENSE_HISTORY_INTERVAL_OPTIONS.map((option) => {
              const selected = option.key === filter.interval;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    updateFilter({ interval: option.key });
                    setIntervalOpen(false);
                  }}
                  style={[
                    styles.optionRow,
                    {
                      borderColor: selected ? appTheme.accent : appTheme.border,
                      backgroundColor: selected ? appTheme.accentSoft : appTheme.background,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={option.icon as ComponentProps<typeof MaterialCommunityIcons>["name"]}
                    size={18}
                    color={selected ? appTheme.accent : appTheme.muted}
                  />
                  <Text className="flex-1 text-sm font-bold text-ink" numberOfLines={1}>
                    {t(INTERVAL_LABEL_KEYS[option.key])}
                  </Text>
                  {selected ? <MaterialCommunityIcons name="check" size={18} color={appTheme.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <CalendarDatePickerModal
        visible={calendarTarget !== null}
        title={calendarTitle}
        value={calendarValue}
        rangeStartDate={filter.interval === "range" ? filter.startDate : null}
        rangeEndDate={filter.interval === "range" ? filter.endDate : null}
        colors={SHOP_CALENDAR_COLORS}
        onSelect={selectCalendarDate}
        onClose={() => setCalendarTarget(null)}
      />
    </View>
  );
});
