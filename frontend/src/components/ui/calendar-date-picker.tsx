import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { createDateTimeFormat } from "@/utils/format";
import { toDateInputValue } from "@/utils/expense-history-filters";
import { ShopText as Text } from "@/components/ui/shop-text";

type CalendarIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type CalendarPickerColors = {
  overlay: string;
  card: string;
  surface: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
};

type CalendarDateFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  colors: CalendarPickerColors;
  icon?: CalendarIconName;
  onPress: () => void;
};

type CalendarDatePickerModalProps = {
  visible: boolean;
  title: string;
  value?: string | null;
  rangeStartDate?: string | null;
  rangeEndDate?: string | null;
  colors: CalendarPickerColors;
  onSelect: (date: string) => void;
  onClose: () => void;
};

const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
const monthFormatter = createDateTimeFormat({ month: "long", year: "numeric" });
const dateLabelFormatter = createDateTimeFormat({
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const selectedBannerFormatter = createDateTimeFormat({
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function parseLocalDateValue(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addDays(value: Date, days: number) {
  const nextDate = new Date(value);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonths(value: Date, months: number) {
  const nextDate = startOfMonth(value);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function buildCalendarCells(visibleMonth: Date) {
  const startDate = addDays(startOfMonth(visibleMonth), -visibleMonth.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(startDate, index);
    return {
      date,
      value: toDateInputValue(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
    };
  });
}

export function formatCalendarDateLabel(value: string | null | undefined) {
  const date = parseLocalDateValue(value);
  return date ? dateLabelFormatter.format(date) : "";
}

export function CalendarDateField({
  label,
  value,
  placeholder = "Select date",
  colors,
  icon = "calendar",
  onPress,
}: CalendarDateFieldProps) {
  const formattedValue = formatCalendarDateLabel(value);
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select ${label}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.fieldButton,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.fieldValue,
            { color: formattedValue ? colors.textPrimary : colors.textMuted },
          ]}
        >
          {formattedValue || placeholder}
        </Text>
        <MaterialCommunityIcons name={icon} size={19} color={colors.accent} />
      </Pressable>
    </View>
  );
}

export function CalendarDatePickerModal({
  visible,
  title,
  value,
  rangeStartDate,
  rangeEndDate,
  colors,
  onSelect,
  onClose,
}: CalendarDatePickerModalProps) {
  const selectedDate = parseLocalDateValue(value);
  const rangeStartValue = parseLocalDateValue(rangeStartDate) ? rangeStartDate?.trim() : null;
  const rangeEndValue = parseLocalDateValue(rangeEndDate) ? rangeEndDate?.trim() : null;
  const selectedValue = selectedDate ? toDateInputValue(selectedDate) : null;
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selectedDate ?? new Date()));

  useEffect(() => {
    if (visible) {
      setVisibleMonth(startOfMonth(parseLocalDateValue(value) ?? new Date()));
    }
  }, [value, visible]);

  const calendarCells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth]);
  const monthTitle = monthFormatter.format(visibleMonth);
  const todayValue = toDateInputValue(new Date());
  const selectedLabel = selectedDate ? selectedBannerFormatter.format(selectedDate) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>
                {title}
              </Text>
              {selectedLabel ? (
                <Text numberOfLines={1} style={[styles.selectedLabel, { color: colors.textMuted }]}>
                  {selectedLabel}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="close" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.monthHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() => setVisibleMonth((current) => addMonths(current, -1))}
              style={[styles.monthButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="chevron-left" size={22} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.monthTitleWrap}>
              <Text style={[styles.monthModeLabel, { color: colors.textMuted }]}>Select day</Text>
              <Text numberOfLines={1} style={[styles.monthTitle, { color: colors.textPrimary }]}>
                {monthTitle}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => setVisibleMonth((current) => addMonths(current, 1))}
              style={[styles.monthButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.weekdayGrid}>
            {dayLabels.map((dayLabel, index) => (
              <Text key={`${dayLabel}-${index}`} style={[styles.weekdayLabel, { color: colors.textMuted }]}>
                {dayLabel}
              </Text>
            ))}
          </View>

          <View style={styles.dayGrid}>
            {calendarCells.map((cell) => {
              const isSelected = cell.value === selectedValue;
              const isToday = cell.value === todayValue;
              const isRangeEdge = cell.value === rangeStartValue || cell.value === rangeEndValue;
              const isInRange = Boolean(
                rangeStartValue && rangeEndValue && cell.value >= rangeStartValue && cell.value <= rangeEndValue,
              );
              const isHighlighted = isSelected || isRangeEdge;
              return (
                <View key={cell.value} style={styles.dayCell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${formatCalendarDateLabel(cell.value)}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onSelect(cell.value)}
                    style={({ pressed }) => [
                      styles.dayButton,
                      {
                        backgroundColor: isHighlighted
                          ? colors.accent
                          : isInRange
                            ? colors.accentSoft
                            : "transparent",
                        borderColor: isToday ? colors.accent : "transparent",
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: isHighlighted
                            ? colors.onAccent
                            : !cell.inCurrentMonth
                              ? colors.textMuted
                              : isInRange || isToday
                                ? colors.accent
                                : colors.textPrimary,
                          opacity: cell.inCurrentMonth || isHighlighted || isInRange ? 1 : 0.5,
                        },
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    flex: 1,
    minWidth: 138,
    gap: 5,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  fieldButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 4,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
  },
  selectedLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
  },
  monthHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  monthButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  monthModeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  monthTitle: {
    marginTop: 3,
    fontSize: 17,
    fontWeight: "800",
  },
  weekdayGrid: {
    flexDirection: "row",
    alignItems: "center",
  },
  weekdayLabel: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
  },
  dayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.2857%",
    padding: 2,
  },
  dayButton: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 14,
    fontWeight: "800",
  },
});
