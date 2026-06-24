import { MaterialCommunityIcons } from "@expo/vector-icons";
import { requireOptionalNativeModule } from "expo-modules-core";
import { StatusBar } from "expo-status-bar";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  downloadAdminReportPdf,
  fetchShops,
  type AdminReportDetailLevel,
  type AdminReportSection,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import type { AdminReportsScreenProps } from "@/navigation/types";
import { AnalyticsPeriod, type ShopRead, type UUID } from "@/types/api";

import { adminShadow, type ThemePalette } from "./admin-dashboard-theme";
import {
  buildDateOptions,
  buildMonthOptions,
  buildWeekOptions,
  buildYearOptions,
  formatAnalyticsReference,
  triggerHaptic,
} from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];
type ExpoSharingNativeModule = {
  isAvailableAsync?: () => Promise<boolean>;
  shareAsync?: (
    url: string,
    options?: {
      dialogTitle?: string;
      mimeType?: string;
      UTI?: string;
    },
  ) => Promise<void>;
};

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: AnalyticsPeriod.DATE, label: "Day" },
  { value: AnalyticsPeriod.RANGE, label: "Range" },
  { value: AnalyticsPeriod.WEEK, label: "Week" },
  { value: AnalyticsPeriod.MONTH, label: "Month" },
  { value: AnalyticsPeriod.YEAR, label: "Year" },
];

const SECTION_OPTIONS: { key: AdminReportSection; label: string; icon: IconName }[] = [
  { key: "sales", label: "Sales", icon: "chart-line" },
  { key: "billing", label: "Billing", icon: "receipt-text-outline" },
  { key: "expenses", label: "Expenses", icon: "currency-inr" },
  { key: "transfers", label: "Transfer Stock", icon: "truck-delivery-outline" },
  { key: "over_report", label: "Overall Report", icon: "file-chart-outline" },
];

const SECTION_ORDER: AdminReportSection[] = [
  "sales",
  "billing",
  "expenses",
  "transfers",
  "over_report",
];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const calendarMonthFormatter = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const calendarDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayValue() {
  return toLocalDateValue(new Date());
}

function daysBeforeToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toLocalDateValue(date);
}

function parseLocalDateValue(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function addMonths(value: string, offset: number) {
  const date = parseLocalDateValue(value);
  return toLocalDateValue(new Date(date.getFullYear(), date.getMonth() + offset, 1));
}

function buildCalendarDays(monthValue: string) {
  const monthDate = parseLocalDateValue(monthValue);
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      value: toLocalDateValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

function isDateBetween(value: string, start?: string | null, end?: string | null) {
  return Boolean(start && end && value >= start && value <= end);
}

function formatCalendarDateLabel(value?: string | null) {
  return value ? calendarDateFormatter.format(parseLocalDateValue(value)) : "Select date";
}

function pluralizeBranch(count: number) {
  return count === 1 ? "1 branch" : `${count} branches`;
}

function formatSelectedBranchNames(shops: ShopRead[], selectedIds: UUID[]) {
  if (selectedIds.length === 0) {
    return "Select branches";
  }
  const selectedIdSet = new Set(selectedIds);
  const selectedNames = shops.filter((shop) => selectedIdSet.has(shop.id)).map((shop) => shop.name);
  if (selectedNames.length === 0) {
    return pluralizeBranch(selectedIds.length);
  }
  if (selectedNames.length <= 2) {
    return selectedNames.join(", ");
  }
  return `${selectedNames.slice(0, 2).join(", ")} +${selectedNames.length - 2}`;
}

function validateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return "Select a start and end date.";
  }
  if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(endDate)) {
    return "Select a valid date range.";
  }
  if (endDate < startDate) {
    return "Range end date must be on or after start date.";
  }
  return "";
}

function formatReportPeriodLabel(
  period: AnalyticsPeriod,
  referenceDate: string,
  rangeStartDate: string | null,
  rangeEndDate: string | null,
) {
  if (period !== AnalyticsPeriod.RANGE) {
    return formatAnalyticsReference(period, referenceDate);
  }
  if (rangeStartDate && rangeEndDate) {
    return rangeStartDate === rangeEndDate
      ? formatCalendarDateLabel(rangeStartDate)
      : `${formatCalendarDateLabel(rangeStartDate)} - ${formatCalendarDateLabel(rangeEndDate)}`;
  }
  return `${formatCalendarDateLabel(rangeStartDate)} - ${formatCalendarDateLabel(rangeEndDate)}`;
}

function getPeriodAccent(period: AnalyticsPeriod, palette: ThemePalette) {
  if (period === AnalyticsPeriod.RANGE) {
    return palette.primary;
  }
  if (period === AnalyticsPeriod.WEEK || period === AnalyticsPeriod.MONTH || period === AnalyticsPeriod.YEAR) {
    return palette.analytics;
  }
  return palette.billing;
}

export function AdminReportsScreen({ navigation }: AdminReportsScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [shops, setShops] = useState<ShopRead[]>([]);
  const [loadingShops, setLoadingShops] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState<AnalyticsPeriod>(AnalyticsPeriod.DATE);
  const [referenceDate, setReferenceDate] = useState(() => todayValue());
  const [rangeStartDate, setRangeStartDate] = useState<string | null>(() => daysBeforeToday(6));
  const [rangeEndDate, setRangeEndDate] = useState<string | null>(() => todayValue());
  const [calendarMonthValue, setCalendarMonthValue] = useState(() => todayValue());
  const [detailLevel, setDetailLevel] = useState<AdminReportDetailLevel>("summary");
  const [allBranches, setAllBranches] = useState(true);
  const [selectedShopIds, setSelectedShopIds] = useState<UUID[]>([]);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [selectedSections, setSelectedSections] = useState<AdminReportSection[]>(["sales"]);
  const [language, setLanguage] = useState<"en" | "ta">("en");

  const dateOptions = useMemo(() => buildDateOptions(), []);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonthValue), [calendarMonthValue]);
  const calendarMonthLabel = useMemo(
    () => calendarMonthFormatter.format(parseLocalDateValue(calendarMonthValue)),
    [calendarMonthValue],
  );
  const selectedShopIdSet = useMemo(() => new Set(selectedShopIds), [selectedShopIds]);
  const branchSelectionLabel = allBranches ? "All branches" : pluralizeBranch(selectedShopIds.length);
  const branchSelectionDetail = allBranches
    ? pluralizeBranch(shops.length)
    : formatSelectedBranchNames(shops, selectedShopIds);
  const currentPeriodLabel = formatReportPeriodLabel(period, referenceDate, rangeStartDate, rangeEndDate);
  const selectedSectionSet = useMemo(() => new Set(selectedSections), [selectedSections]);
  const hasOverallReport = selectedSectionSet.has("over_report");
  const canGenerate = selectedSections.length > 0 && (allBranches || selectedShopIds.length > 0) && !generating;
  const periodAccent = getPeriodAccent(period, palette);

  useEffect(() => {
    const controller = new AbortController();
    setErrorMessage(null);
    setLoadingShops(true);
    fetchShops({ signal: controller.signal })
      .then(setShops)
      .catch((error) => {
        if (!isApiRequestCanceled(error)) {
          setErrorMessage(toApiError(error).message || "Branches could not be loaded.");
        }
      })
      .finally(() => setLoadingShops(false));
    return () => controller.abort();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchShops().then(setShops);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Branches could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleSelectPeriod = useCallback(
    (nextPeriod: AnalyticsPeriod) => {
      triggerHaptic();
      setPeriod(nextPeriod);
      if (nextPeriod === AnalyticsPeriod.DATE) {
        const nextDate = dateOptions[0]?.value ?? todayValue();
        setReferenceDate(nextDate);
        setCalendarMonthValue(nextDate);
      } else if (nextPeriod === AnalyticsPeriod.RANGE) {
        setCalendarMonthValue(rangeStartDate ?? referenceDate);
      } else if (nextPeriod === AnalyticsPeriod.WEEK) {
        setReferenceDate(weekOptions[0]?.value ?? todayValue());
      } else if (nextPeriod === AnalyticsPeriod.MONTH) {
        setReferenceDate(monthOptions[0]?.value ?? todayValue());
      } else if (nextPeriod === AnalyticsPeriod.YEAR) {
        setReferenceDate(yearOptions[0]?.value ?? todayValue());
      }
    },
    [dateOptions, monthOptions, rangeStartDate, referenceDate, weekOptions, yearOptions],
  );

  const handleSelectCalendarDate = useCallback((value: string) => {
    triggerHaptic();
    if (period === AnalyticsPeriod.DATE) {
      setReferenceDate(value);
      setCalendarMonthValue(value);
      return;
    }

    setRangeStartDate((currentStart) => {
      if (!currentStart || rangeEndDate) {
        setRangeEndDate(null);
        return value;
      }
      if (value < currentStart) {
        setRangeEndDate(currentStart);
        return value;
      }
      setRangeEndDate(value);
      return currentStart;
    });
  }, [period, rangeEndDate]);

  const handleShowPreviousCalendarMonth = useCallback(() => {
    setCalendarMonthValue((current) => addMonths(current, -1));
  }, []);

  const handleShowNextCalendarMonth = useCallback(() => {
    setCalendarMonthValue((current) => addMonths(current, 1));
  }, []);

  const handleToggleSection = useCallback((section: AdminReportSection) => {
    triggerHaptic();
    setSelectedSections((current) => {
      const next = current.includes(section)
        ? current.filter((value) => value !== section)
        : [...current, section];
      return SECTION_ORDER.filter((value) => next.includes(value));
    });
  }, []);

  const handleSelectAllBranches = useCallback(() => {
    triggerHaptic();
    setAllBranches(true);
    setSelectedShopIds([]);
    setBranchDropdownOpen(false);
  }, []);

  const handleToggleShop = useCallback((shopId: UUID) => {
    triggerHaptic();
    setAllBranches(false);
    setSelectedShopIds((current) => {
      if (current.includes(shopId)) {
        const next = current.filter((value) => value !== shopId);
        if (next.length === 0) {
          setAllBranches(true);
        }
        return next;
      }
      return [...current, shopId];
    });
  }, []);

  const handleToggleBranchDropdown = useCallback(() => {
    triggerHaptic();
    setBranchDropdownOpen((open) => !open);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) {
      return;
    }
    const rangeError = period === AnalyticsPeriod.RANGE ? validateRange(rangeStartDate, rangeEndDate) : "";
    if (rangeError) {
      setErrorMessage(rangeError);
      return;
    }

    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await downloadAdminReportPdf({
        sections: selectedSections,
        detailLevel,
        period,
        referenceDate: period === AnalyticsPeriod.RANGE ? undefined : referenceDate,
        range:
          period === AnalyticsPeriod.RANGE
            ? { startDate: rangeStartDate, endDate: rangeEndDate }
            : undefined,
        shopIds: allBranches ? undefined : selectedShopIds,
        language,
      });
      const sharingModule = requireOptionalNativeModule<ExpoSharingNativeModule>("ExpoSharing");
      let shared = false;
      if (sharingModule?.shareAsync) {
        const sharingAvailable = sharingModule.isAvailableAsync
          ? await sharingModule.isAvailableAsync().catch(() => false)
          : true;
        if (sharingAvailable) {
          await sharingModule
            .shareAsync(result.uri, {
              dialogTitle: "Admin report",
              mimeType: "application/pdf",
              UTI: "com.adobe.pdf",
            })
            .then(() => {
              shared = true;
            })
            .catch(() => {
              shared = false;
            });
        }
      }
      if (!shared) {
        Alert.alert("Report downloaded", result.filename);
      }
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Report could not be generated.");
    } finally {
      setGenerating(false);
    }
  }, [
    allBranches,
    canGenerate,
    detailLevel,
    language,
    period,
    rangeEndDate,
    rangeStartDate,
    referenceDate,
    selectedSections,
    selectedShopIds,
  ]);

  const handlePreviewOverallReport = useCallback(() => {
    if (!canGenerate) {
      return;
    }
    const rangeError = period === AnalyticsPeriod.RANGE ? validateRange(rangeStartDate, rangeEndDate) : "";
    if (rangeError) {
      setErrorMessage(rangeError);
      return;
    }
    navigation.navigate("AdminOverallReportPreview", {
      sections: selectedSections,
      detailLevel,
      period,
      referenceDate: period === AnalyticsPeriod.RANGE ? undefined : referenceDate,
      range:
        period === AnalyticsPeriod.RANGE
          ? { startDate: rangeStartDate, endDate: rangeEndDate }
          : undefined,
      shopIds: allBranches ? undefined : selectedShopIds,
      language,
    });
  }, [
    allBranches,
    canGenerate,
    detailLevel,
    language,
    navigation,
    period,
    rangeEndDate,
    rangeStartDate,
    referenceDate,
    selectedSections,
    selectedShopIds,
  ]);

  const getReferenceOptions = () => {
    if (period === AnalyticsPeriod.DATE) {
      return dateOptions;
    }
    if (period === AnalyticsPeriod.WEEK) {
      return weekOptions;
    }
    if (period === AnalyticsPeriod.MONTH) {
      return monthOptions;
    }
    if (period === AnalyticsPeriod.YEAR) {
      return yearOptions;
    }
    return [];
  };

  const renderCalendarPicker = () => (
    <View
      style={[
        styles.calendarPanel,
        adminShadow(palette.shadow, 0.03, 7, 10),
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.calendarHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={handleShowPreviousCalendarMonth}
          style={[
            styles.calendarIconButton,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
          ]}
        >
          <MaterialCommunityIcons name="chevron-left" size={22} color={palette.textSecondary} />
        </Pressable>
        <View style={styles.calendarTitleWrap}>
          <Text style={[styles.calendarModeLabel, { color: palette.textMuted }]}>
            {period === AnalyticsPeriod.RANGE ? "Custom range" : "Select day"}
          </Text>
          <Text style={[styles.calendarMonthTitle, { color: palette.textPrimary }]}>
            {calendarMonthLabel}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={handleShowNextCalendarMonth}
          style={[
            styles.calendarIconButton,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
          ]}
        >
          <MaterialCommunityIcons name="chevron-right" size={22} color={palette.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {CALENDAR_WEEKDAYS.map((weekday) => (
          <Text key={weekday} style={[styles.weekdayText, { color: palette.textMuted }]}>
            {weekday}
          </Text>
        ))}
      </View>

      <View style={styles.calendarGrid}>
        {calendarDays.map((day) => {
          const isDaySelected = period === AnalyticsPeriod.DATE && day.value === referenceDate;
          const isRangeStart = period === AnalyticsPeriod.RANGE && day.value === rangeStartDate;
          const isRangeEnd = period === AnalyticsPeriod.RANGE && day.value === rangeEndDate;
          const isRangeEdge = isRangeStart || isRangeEnd;
          const isRangeMiddle =
            period === AnalyticsPeriod.RANGE &&
            isDateBetween(day.value, rangeStartDate, rangeEndDate) &&
            !isRangeEdge;
          const selected = isDaySelected || isRangeEdge;
          const isToday = day.value === todayValue();

          return (
            <View key={day.value} style={styles.calendarDayCell}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={formatCalendarDateLabel(day.value)}
                onPress={() => handleSelectCalendarDate(day.value)}
                style={[
                  styles.calendarDayButton,
                  {
                    backgroundColor: selected
                      ? palette.primary
                      : isRangeMiddle
                        ? palette.primarySoft
                        : "transparent",
                    borderColor: isToday ? palette.primary : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.calendarDayText,
                    {
                      color: selected
                        ? palette.onPrimary
                        : !day.inMonth
                          ? palette.textMuted
                          : isRangeMiddle || isToday
                            ? palette.primaryStrong
                            : palette.textPrimary,
                      opacity: day.inMonth || selected || isRangeMiddle ? 1 : 0.5,
                    },
                  ]}
                >
                  {day.day}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {period === AnalyticsPeriod.RANGE ? (
        <View style={[styles.rangeFooter, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <View style={styles.rangeDatesRow}>
            <View style={styles.rangeDateBlock}>
              <Text style={[styles.rangeDateLabel, { color: palette.textMuted }]}>Start</Text>
              <Text style={[styles.rangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                {formatCalendarDateLabel(rangeStartDate)}
              </Text>
            </View>
            <View style={[styles.rangeDivider, { backgroundColor: palette.border }]} />
            <View style={styles.rangeDateBlock}>
              <Text style={[styles.rangeDateLabel, { color: palette.textMuted }]}>End</Text>
              <Text style={[styles.rangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                {formatCalendarDateLabel(rangeEndDate)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );

  const renderBranchOption = (item: ShopRead) => {
    const selected = !allBranches && selectedShopIdSet.has(item.id);
    return (
      <Pressable
        key={item.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={() => handleToggleShop(item.id)}
        style={[
          styles.branchDropdownOption,
          {
            backgroundColor: selected ? palette.primarySoft : palette.card,
            borderColor: selected ? palette.primary : palette.border,
          },
        ]}
      >
        <View style={[styles.branchIcon, { backgroundColor: selected ? palette.primary : palette.surfaceMuted }]}>
          <MaterialCommunityIcons name="storefront-outline" size={18} color={selected ? palette.onPrimary : palette.textMuted} />
        </View>
        <View style={styles.branchTextWrap}>
          <Text numberOfLines={1} style={[styles.branchName, { color: palette.textPrimary }]}>
            {item.name}
          </Text>
          <Text numberOfLines={1} style={[styles.branchMeta, { color: palette.textMuted }]}>
            {item.is_active ? "Active" : "Paused"}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={selected ? "check-circle" : "checkbox-blank-circle-outline"}
          size={20}
          color={selected ? palette.primary : palette.textMuted}
        />
      </Pressable>
    );
  };

  const renderHeader = () => (
    <View style={styles.contentHeader}>
      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Period</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodScroller}>
          {PERIOD_OPTIONS.map((option) => {
            const selected = option.value === period;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => handleSelectPeriod(option.value)}
                style={[
                  styles.periodChip,
                  {
                    backgroundColor: selected ? periodAccent : palette.card,
                    borderColor: selected ? periodAccent : palette.border,
                  },
                ]}
              >
                <Text style={[styles.periodChipText, { color: selected ? palette.onPrimary : palette.textSecondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {period === AnalyticsPeriod.DATE || period === AnalyticsPeriod.RANGE ? (
          renderCalendarPicker()
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.referenceScroller}>
            {getReferenceOptions().map((option) => {
              const selected = option.value === referenceDate;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    triggerHaptic();
                    setReferenceDate(option.value);
                  }}
                  style={[
                    styles.referenceChip,
                    {
                      backgroundColor: selected ? palette.primarySoft : palette.card,
                      borderColor: selected ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.referenceChipText, { color: selected ? palette.primaryStrong : palette.textSecondary }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Text style={[styles.selectionSummary, { color: palette.textMuted }]} numberOfLines={1}>
          {currentPeriodLabel}
        </Text>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Detail</Text>
        <View style={[styles.segmentedControl, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          {(["summary", "full"] as AdminReportDetailLevel[]).map((level) => {
            const selected = detailLevel === level;
            return (
              <Pressable
                key={level}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  triggerHaptic();
                  setDetailLevel(level);
                }}
                style={[
                  styles.segmentButton,
                  {
                    backgroundColor: selected ? palette.card : "transparent",
                    borderColor: selected ? palette.border : "transparent",
                  },
                ]}
              >
                <Text style={[styles.segmentText, { color: selected ? palette.textPrimary : palette.textMuted }]}>
                  {level === "summary" ? "Summary" : "Full"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Reports</Text>
        <View style={styles.sectionGrid}>
          {SECTION_OPTIONS.map((option) => {
            const selected = selectedSectionSet.has(option.key);
            return (
              <Pressable
                key={option.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => handleToggleSection(option.key)}
                style={[
                  styles.sectionCard,
                  adminShadow(palette.shadow, selected ? 0.07 : 0.03, 6, 8),
                  {
                    backgroundColor: selected ? palette.primarySoft : palette.card,
                    borderColor: selected ? palette.primary : palette.border,
                  },
                ]}
              >
                <View style={[styles.sectionIcon, { backgroundColor: selected ? palette.primary : palette.surfaceMuted }]}>
                  <MaterialCommunityIcons name={option.icon} size={18} color={selected ? palette.onPrimary : palette.textSecondary} />
                </View>
                <Text style={[styles.sectionCardText, { color: selected ? palette.primaryStrong : palette.textPrimary }]}>
                  {option.label}
                </Text>
                <MaterialCommunityIcons
                  name={selected ? "check-circle" : "checkbox-blank-circle-outline"}
                  size={18}
                  color={selected ? palette.primary : palette.textMuted}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      {hasOverallReport ? (
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Language</Text>
          <View style={[styles.segmentedControl, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            {(["en", "ta"] as ("en" | "ta")[]).map((lang) => {
              const selected = language === lang;
              return (
                <Pressable
                  key={lang}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    triggerHaptic();
                    setLanguage(lang);
                  }}
                  style={[
                    styles.segmentButton,
                    {
                      backgroundColor: selected ? palette.card : "transparent",
                      borderColor: selected ? palette.border : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.segmentText, { color: selected ? palette.textPrimary : palette.textMuted }]}>
                    {lang === "en" ? "English" : "Tamil"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <View style={styles.branchHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Branches</Text>
          <Text style={[styles.branchCount, { color: palette.textMuted }]}>{branchSelectionLabel}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: branchDropdownOpen }}
          onPress={handleToggleBranchDropdown}
          style={[
            styles.branchSelectButton,
            {
              backgroundColor: palette.card,
              borderColor: branchDropdownOpen ? palette.primary : palette.border,
            },
          ]}
        >
          <View style={[styles.branchIcon, { backgroundColor: allBranches ? palette.settingsSoft : palette.primarySoft }]}>
            <MaterialCommunityIcons name="source-branch" size={18} color={allBranches ? palette.settings : palette.primary} />
          </View>
          <View style={styles.branchTextWrap}>
            <Text style={[styles.branchName, { color: palette.textPrimary }]}>{branchSelectionLabel}</Text>
            <Text numberOfLines={1} style={[styles.branchMeta, { color: palette.textMuted }]}>
              {branchSelectionDetail}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={branchDropdownOpen ? "chevron-up" : "chevron-down"}
            size={22}
            color={palette.textMuted}
          />
        </Pressable>
        {branchDropdownOpen ? (
          <View style={[styles.branchDropdown, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allBranches }}
              onPress={handleSelectAllBranches}
              style={[
                styles.branchDropdownOption,
                {
                  backgroundColor: allBranches ? palette.settingsSoft : palette.card,
                  borderColor: allBranches ? palette.settings : palette.border,
                },
              ]}
            >
              <View style={[styles.branchIcon, { backgroundColor: allBranches ? palette.settings : palette.surfaceMuted }]}>
                <MaterialCommunityIcons
                  name="source-branch"
                  size={18}
                  color={allBranches ? palette.background : palette.textMuted}
                />
              </View>
              <View style={styles.branchTextWrap}>
                <Text style={[styles.branchName, { color: palette.textPrimary }]}>All branches</Text>
                <Text style={[styles.branchMeta, { color: palette.textMuted }]}>{pluralizeBranch(shops.length)}</Text>
              </View>
              <MaterialCommunityIcons
                name={allBranches ? "check-circle" : "checkbox-blank-circle-outline"}
                size={20}
                color={allBranches ? palette.settings : palette.textMuted}
              />
            </Pressable>
            {loadingShops ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={palette.primary} />
              </View>
            ) : (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={shops.length > 4}
                style={styles.branchDropdownScroll}
                contentContainerStyle={styles.branchDropdownContent}
              >
                {shops.map(renderBranchOption)}
              </ScrollView>
            )}
            {!allBranches ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setBranchDropdownOpen(false)}
                style={[styles.branchDoneButton, { backgroundColor: palette.primary, borderColor: palette.primary }]}
              >
                <Text style={[styles.branchDoneText, { color: palette.onPrimary }]}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

    </View>
  );

  const renderFooter = () => (
    <View style={[styles.footer, { paddingBottom: 32 + insets.bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canGenerate }}
        disabled={!canGenerate}
        onPress={handleGenerate}
        style={[
          styles.generateButton,
          adminShadow(palette.shadow, 0.08, 10, 14),
          {
            backgroundColor: canGenerate ? palette.primary : palette.surfaceMuted,
            opacity: canGenerate ? 1 : 0.72,
          },
        ]}
      >
        {generating ? (
          <ActivityIndicator size="small" color={palette.onPrimary} />
        ) : (
          <MaterialCommunityIcons
            name={hasOverallReport ? "file-chart-outline" : "file-pdf-box"}
            size={21}
            color={palette.onPrimary}
          />
        )}
        <Text style={[styles.generateButtonText, { color: palette.onPrimary }]}>
          {generating ? "Generating..." : `Generate PDF`}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            Reports
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {branchSelectionLabel}
          </Text>
        </View>
        <AdminHeaderActions refreshing={refreshing} onRefresh={handleRefresh} />
      </View>

      <FlatList
        data={[] as ShopRead[]}
        keyExtractor={(item) => item.id}
        renderItem={() => null}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={palette.primary}
            colors={[palette.primary]}
          />
        }
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={48}
        windowSize={7}
        extraData={`${allBranches}-${selectedShopIds.join(",")}-${selectedSections.join(",")}-${detailLevel}-${period}-${branchDropdownOpen}-${language}`}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  contentHeader: {
    gap: 14,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  errorBanner: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
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
  },
  periodScroller: {
    gap: 8,
    paddingRight: 6,
  },
  periodChip: {
    minWidth: 76,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  periodChipText: {
    fontSize: 13,
    fontWeight: "800",
  },
  referenceScroller: {
    gap: 8,
    paddingRight: 6,
  },
  referenceChip: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  referenceChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  selectionSummary: {
    fontSize: 12,
    fontWeight: "700",
  },
  calendarPanel: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  calendarHeader: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  calendarIconButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarTitleWrap: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
  },
  calendarModeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  calendarMonthTitle: {
    marginTop: 3,
    fontSize: 17,
    fontWeight: "800",
  },
  weekdayRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  weekdayText: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDayCell: {
    width: "14.2857%",
    padding: 2,
  },
  calendarDayButton: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDayText: {
    fontSize: 14,
    fontWeight: "800",
  },
  rangeFooter: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  rangeDatesRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  rangeDateBlock: {
    minWidth: 0,
    flex: 1,
  },
  rangeDateLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  rangeDateValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
  },
  rangeDivider: {
    width: 1,
  },
  segmentedControl: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    flexDirection: "row",
    gap: 6,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "800",
  },
  sectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  sectionCard: {
    width: "48%",
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCardText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "800",
  },
  branchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  branchCount: {
    fontSize: 12,
    fontWeight: "800",
  },
  branchSelectButton: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  branchDropdown: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 8,
    gap: 8,
  },
  branchDropdownScroll: {
    maxHeight: 278,
  },
  branchDropdownContent: {
    gap: 8,
  },
  branchDropdownOption: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  branchIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  branchTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  branchName: {
    fontSize: 14,
    fontWeight: "800",
  },
  branchMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  loadingRow: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  overallPreviewList: {
    gap: 12,
  },
  overallStatement: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  overallStatementHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  overallStatementTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  overallStatementTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  overallStatementMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  overallStatementAmount: {
    maxWidth: 116,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  reportMetricList: {
    gap: 0,
  },
  reportMetricRow: {
    minHeight: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reportMetricText: {
    flex: 1,
    minWidth: 0,
  },
  reportMetricLabel: {
    fontSize: 12,
    fontWeight: "800",
  },
  reportMetricNote: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  reportMetricValue: {
    maxWidth: 132,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
  },
  inventoryReportList: {
    gap: 0,
  },
  inventoryReportItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inventoryReportHeader: {
    minHeight: 50,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inventoryReportTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  inventoryReportTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  inventoryReportMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  inventoryReportBody: {
    paddingBottom: 10,
    gap: 8,
  },
  billingReportList: {
    gap: 0,
  },
  billingReportRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    gap: 8,
  },
  billingReportHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  billingReportTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  billingReportTitle: {
    fontSize: 12,
    fontWeight: "900",
  },
  billingReportMeta: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  billingReportPrice: {
    maxWidth: 96,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "right",
  },
  billingMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  reportMiniMetric: {
    width: "31.5%",
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center",
  },
  reportMiniLabel: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reportMiniValue: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "900",
  },
  reportEmptyRow: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  reportEmptyText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  branchDoneButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  branchDoneText: {
    fontSize: 13,
    fontWeight: "800",
  },
  footer: {
    paddingTop: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  generateButton: {
    minHeight: 54,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 18,
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: "800",
  },
});
