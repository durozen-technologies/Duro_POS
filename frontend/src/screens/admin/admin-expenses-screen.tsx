import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchShops } from "@/api/admin";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import {
  allocateShopExpenseItems,
  createExpenseItem,
  deallocateShopExpenseItem,
  deleteExpenseItemImage,
  deleteExpenseItem,
  fetchAdminExpenseHistory,
  fetchExpenseItemCounts,
  fetchExpenseItemRows,
  fetchShopExpenseItemCandidateRows,
  fetchShopExpenseItemRows,
  replaceExpenseItemImageFile,
  updateAdminExpenseEntry,
  updateExpenseItem,
  updateShopExpenseAllocation,
  type ExpenseItemImageUploadFile,
} from "@/api/expenses";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { AdminExpensesScreenProps } from "@/navigation/types";
import { useFocusEffect } from "@react-navigation/native";
import type {
  ExpenseEntryRead,
  ExpenseItemCounts,
  ExpenseItemRead,
  ShopExpenseItemRead,
  ShopRead,
  UUID,
} from "@/types/api";
import {
  buildExpenseHistoryRange,
  createExpenseHistoryFilterDraft,
  EXPENSE_HISTORY_INTERVAL_OPTIONS,
  toDateInputValue,
  type ExpenseHistoryFilterDraft,
  type ExpenseHistoryRange,
} from "@/utils/expense-history-filters";
import { createDateTimeFormat, formatCurrency, formatDateTime } from "@/utils/format";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminElevation, adminRadii, type ThemePalette } from "./admin-dashboard-theme";
import {
  buildMonthOptions,
  buildWeekOptions,
  buildYearOptions,
  triggerHaptic,
} from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { AdminTextField } from "@/screens/admin/components/admin-text-field";
import { useAdminTheme } from "./use-admin-theme";
import { CalendarDateField, CalendarDatePickerModal } from "@/components/ui/calendar-date-picker";
import { TimePickerField, TimePickerModal } from "@/components/ui/time-picker";

type ExpenseTab = "items" | "allocation" | "history";
type ExpoImagePickerModule = typeof import("expo-image-picker");
type ImageDraft = ExpenseItemImageUploadFile;
type PickedImageAsset = {
  uri: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};

type CursorState = {
  sortOrder: number | null;
  name: string | null;
  id: UUID | null;
};

const PAGE_LIMIT = 50;
const CANDIDATE_LIMIT = 20;
const MAX_EXPENSE_ITEM_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const EXPENSE_ITEM_IMAGE_UPLOAD_DRAFT_DIR = "expense-item-image-uploads";
const EXPENSE_CALENDAR_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const expenseCalendarMonthFormatter = createDateTimeFormat({ month: "long", year: "numeric" });
const expenseCalendarDateFormatter = createDateTimeFormat({
  day: "numeric",
  month: "short",
  year: "numeric",
});
const EMPTY_CURSOR: CursorState = { sortOrder: null, name: null, id: null };
const EMPTY_COUNTS: ExpenseItemCounts = {
  all: 0,
  active: 0,
  paused: 0,
  allocated: 0,
  available: 0,
};
const TABS: { key: ExpenseTab; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"] }[] = [
  { key: "items", label: "Items", icon: "playlist-plus" },
  { key: "allocation", label: "Allocation", icon: "source-branch" },
  { key: "history", label: "History", icon: "history" },
];

async function loadImagePickerModule(): Promise<ExpoImagePickerModule | null> {
  try {
    return await import("expo-image-picker");
  } catch {
    return null;
  }
}

function extensionForImageType(contentType: string) {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "image/webp") {
    return ".webp";
  }
  return ".jpg";
}

function normalizedImageFilename(asset: PickedImageAsset, contentType: string) {
  const fallbackName = `expense-item-${Date.now()}${extensionForImageType(contentType)}`;
  const candidate = asset.fileName?.trim() || fallbackName;
  const sanitized = candidate.replace(/[^a-zA-Z0-9._-]/g, "-");
  return /\.[a-zA-Z0-9]+$/.test(sanitized)
    ? sanitized
    : `${sanitized}${extensionForImageType(contentType)}`;
}

function readableBytes(byteCount: number) {
  return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

async function ensureImageUploadDraftDirectory() {
  const parentDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!parentDirectory) {
    throw new Error("Image upload storage is unavailable on this device.");
  }
  const uploadDirectory = `${parentDirectory}${EXPENSE_ITEM_IMAGE_UPLOAD_DRAFT_DIR}`;
  try {
    await FileSystem.makeDirectoryAsync(uploadDirectory, { intermediates: true });
  } catch (error) {
    const directoryInfo = await FileSystem.getInfoAsync(uploadDirectory);
    if (!directoryInfo.exists || !directoryInfo.isDirectory) {
      throw error;
    }
  }
  return uploadDirectory;
}

async function copyImageToUploadDraftDirectory(sourceUri: string, name: string) {
  const uploadDirectory = await ensureImageUploadDraftDirectory();
  const cachedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
  const cachedUri = `${uploadDirectory.replace(/\/$/, "")}/${cachedName}`;
  await FileSystem.copyAsync({ from: sourceUri, to: cachedUri });
  return cachedUri;
}

async function deleteImageDraftFile(draft: ImageDraft | null) {
  if (!draft?.uri) {
    return;
  }
  try {
    await FileSystem.deleteAsync(draft.uri, { idempotent: true });
  } catch {
    // Temporary image drafts may already be gone.
  }
}

async function getLocalFileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error("Selected image file is no longer available. Pick it again and save.");
  }
  return typeof info.size === "number" ? info.size : null;
}

async function prepareImageDraftForUpload(asset: PickedImageAsset): Promise<ImageDraft> {
  const contentType = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const name = normalizedImageFilename(asset, contentType);
  if (!asset.uri) {
    throw new Error("Selected image has no readable file URI. Pick another image.");
  }
  if (typeof asset.fileSize === "number" && asset.fileSize > MAX_EXPENSE_ITEM_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `Selected image is ${readableBytes(asset.fileSize)}. Choose an image under ${readableBytes(MAX_EXPENSE_ITEM_IMAGE_UPLOAD_BYTES)}.`,
    );
  }
  const cachedUri = await copyImageToUploadDraftDirectory(asset.uri, name);
  const preparedSize = await getLocalFileSize(cachedUri);
  if (preparedSize !== null && preparedSize > MAX_EXPENSE_ITEM_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `Selected image is ${readableBytes(preparedSize)}. Choose an image under ${readableBytes(MAX_EXPENSE_ITEM_IMAGE_UPLOAD_BYTES)}.`,
    );
  }
  return { uri: cachedUri, name, type: contentType };
}

function pageCursor(page: {
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}): CursorState {
  return {
    sortOrder: page.next_cursor_sort_order ?? null,
    name: page.next_cursor_name ?? null,
    id: page.next_cursor_id ?? null,
  };
}

function mergeById<T extends { id: UUID }>(current: T[], nextRows: T[]) {
  const existingIds = new Set(current.map((row) => row.id));
  return [...current, ...nextRows.filter((row) => !existingIds.has(row.id))];
}

function formatCount(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function isValidExpenseAmount(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return false;
  }
  return Number(trimmed) > 0;
}

function expenseEntrySplit(entry: ExpenseEntryRead) {
  const total = Number(entry.amount ?? 0);
  const cash = entry.cash_amount != null ? Number(entry.cash_amount) : total;
  const upi = entry.upi_amount != null ? Number(entry.upi_amount) : 0;
  return { cash, upi, total: total || cash + upi };
}

function entrySpentAtDateValue(spentAt: string) {
  return toDateInputValue(new Date(spentAt));
}

function entrySpentAtTimeValue(spentAt: string) {
  const date = new Date(spentAt);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildSpentAtPayload(dateValue: string, timeValue: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  const hours = match ? match[1] : "00";
  const minutes = match ? match[2] : "00";
  const parsed = new Date(`${dateValue}T${hours}:${minutes}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function parseExpenseLocalDateValue(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function addExpenseCalendarMonths(value: string, offset: number) {
  const date = parseExpenseLocalDateValue(value);
  return toDateInputValue(new Date(date.getFullYear(), date.getMonth() + offset, 1));
}

function buildExpenseCalendarDays(monthValue: string) {
  const monthDate = parseExpenseLocalDateValue(monthValue);
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      value: toDateInputValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

function isExpenseDateBetween(value: string, start?: string | null, end?: string | null) {
  return Boolean(start && end && value >= start && value <= end);
}

function formatExpenseCalendarDateLabel(value?: string | null) {
  return value ? expenseCalendarDateFormatter.format(parseExpenseLocalDateValue(value)) : "Select date";
}

function addExpenseDays(value: string, offset: number) {
  const date = parseExpenseLocalDateValue(value);
  date.setDate(date.getDate() + offset);
  return toDateInputValue(date);
}

function formatExpenseReferenceSubtitle(interval: ExpenseHistoryFilterDraft["interval"], value: string) {
  if (interval === "week") {
    return `${formatExpenseCalendarDateLabel(value)} - ${formatExpenseCalendarDateLabel(addExpenseDays(value, 6))}`;
  }
  if (interval === "month") {
    const [yearText, monthText] = value.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const start = toDateInputValue(new Date(year, monthIndex, 1));
    const end = toDateInputValue(new Date(year, monthIndex + 1, 0));
    return `${formatExpenseCalendarDateLabel(start)} - ${formatExpenseCalendarDateLabel(end)}`;
  }
  if (interval === "year") {
    return `${formatExpenseCalendarDateLabel(`${value}-01-01`)} - ${formatExpenseCalendarDateLabel(`${value}-12-31`)}`;
  }
  return "";
}

function useSelectedShop(shops: ShopRead[], selectedShopId: UUID | null) {
  return useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? shops[0] ?? null,
    [selectedShopId, shops],
  );
}

function IconButton({
  label,
  icon,
  tone,
  disabled = false,
  loading = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  tone: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          borderColor: tone,
          opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone} />
      ) : (
        <MaterialCommunityIcons name={icon} size={18} color={tone} />
      )}
    </Pressable>
  );
}

function AdminButton({
  label,
  onPress,
  palette,
  disabled = false,
  loading = false,
  variant = "danger",
  style,
}: {
  label: string;
  onPress: () => void;
  palette: ThemePalette;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "contrast";
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const isSecondary = variant === "secondary";
  const isContrast = variant === "contrast";
  const backgroundColor = isDisabled
    ? palette.surfaceMuted
    : isSecondary
      ? palette.card
      : variant === "danger"
        ? palette.danger
        : isContrast
          ? palette.textPrimary
          : palette.primary;
  const borderColor = isDisabled
    ? palette.border
    : isSecondary
      ? palette.border
      : variant === "danger"
        ? palette.danger
        : isContrast
          ? palette.textPrimary
          : palette.primary;
  const contentColor = isDisabled
    ? palette.textMuted
    : isSecondary
      ? palette.textPrimary
      : isContrast
        ? palette.card
        : palette.onPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.adminButton,
        {
          backgroundColor,
          borderColor,
          opacity: disabled && !loading ? 0.7 : 1,
          transform: [{ translateY: pressed && !isDisabled ? 1 : 0 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={contentColor} />
      ) : (
        <Text numberOfLines={1} style={[styles.adminButtonText, { color: contentColor }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  tone,
  active = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const isDisabled = disabled;
  let fg = isDisabled ? palette.textMuted : active ? palette.onPrimary : palette.textPrimary;
  let bg = isDisabled ? palette.surfaceMuted : active ? palette.inventory : palette.card;
  let border = isDisabled ? palette.border : active ? palette.inventory : palette.border;

  if (tone === "danger") {
    fg = palette.danger;
    bg = active ? palette.dangerSoft : palette.card;
    border = palette.danger;
  } else if (tone === "success") {
    fg = active ? palette.onPrimary : palette.success;
    bg = active ? palette.success : palette.successSoft;
    border = palette.success;
  } else if (tone === "warning") {
    fg = active ? palette.onCash : palette.warning;
    bg = active ? palette.cash : palette.warningSoft;
    border = palette.warning;
  } else if (tone === "info") {
    fg = active ? palette.onPrimary : palette.primaryStrong;
    bg = active ? palette.primary : palette.primarySoft;
    border = palette.primaryStrong;
  } else if (tone === "primary") {
    fg = active ? palette.onPrimary : palette.primaryStrong;
    bg = active ? palette.primary : palette.primarySoft;
    border = palette.primary;
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      accessibilityState={{ disabled: isDisabled }}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      style={[styles.actionButton, { borderColor: border, backgroundColor: bg, opacity: isDisabled ? 0.6 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={fg} />
      <Text numberOfLines={1} style={[styles.actionText, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AdminEmptyState({
  title,
  description,
  palette,
}: {
  title: string;
  description: string;
  palette: ThemePalette;
}) {
  return (
    <View style={[styles.adminEmptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.adminEmptyIcon, { backgroundColor: palette.cashSoft, borderColor: palette.border }]}>
        <MaterialCommunityIcons name="cash-minus" size={24} color={palette.cash} />
      </View>
      <Text style={[styles.adminEmptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.adminEmptyText, { color: palette.textMuted }]}>{description}</Text>
    </View>
  );
}

function AdminLoadingState({
  label,
  palette,
}: {
  label: string;
  palette: ThemePalette;
}) {
  return (
    <View style={[styles.adminLoadingWrap, { backgroundColor: palette.background }]}>
      <View style={[styles.adminLoadingIcon, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
      <Text style={[styles.adminLoadingText, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}



function CountStrip({ counts, palette }: { counts: ExpenseItemCounts; palette: ReturnType<typeof useAdminTheme>["palette"] }) {
  return (
    <View style={styles.countStrip}>
      {[
        ["All", counts.all],
        ["Active", counts.active],
        ["Paused", counts.paused],
        ["Allocated", counts.allocated],
        ["Available", counts.available],
      ].map(([label, value]) => (
        <View key={label} style={[styles.countPill, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <Text style={[styles.countValue, { color: palette.textPrimary }]}>{value}</Text>
          <Text style={[styles.countLabel, { color: palette.textMuted }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function BranchDropdown({
  shops,
  selectedShopId,
  includeAll = false,
  onSelect,
  palette,
}: {
  shops: ShopRead[];
  selectedShopId: UUID | null;
  includeAll?: boolean;
  onSelect: (shopId: UUID | null) => void;
  palette: ReturnType<typeof useAdminTheme>["palette"];
}) {
  const [open, setOpen] = useState(false);
  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;
  const selectedLabel = includeAll && selectedShopId === null
    ? "All branches"
    : selectedShop?.name ?? "Select branch";
  const options: { id: UUID | null; name: string }[] = [
    ...(includeAll ? [{ id: null, name: "All branches" }] : []),
    ...shops.map((shop) => ({ id: shop.id, name: shop.name })),
  ];

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select branch"
        onPress={() => setOpen(true)}
        style={[styles.dropdownSelect, { backgroundColor: palette.card, borderColor: palette.border }]}
      >
        <View style={styles.dropdownTextWrap}>
          <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>Branch</Text>
          <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
            {selectedLabel}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.dropdownOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.dropdownSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.dropdownSheetHeader}>
              <Text style={[styles.dropdownSheetTitle, { color: palette.textPrimary }]}>Select branch</Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.dropdownClose}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.dropdownOptionList}>
              {options.map((option) => {
                const selected = option.id === selectedShopId;
                return (
                  <Pressable
                    key={option.id ?? "all"}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onSelect(option.id);
                      setOpen(false);
                    }}
                    style={[
                      styles.dropdownOption,
                      {
                        backgroundColor: selected ? palette.cashSoft : palette.surfaceMuted,
                        borderColor: selected ? palette.cash : palette.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={option.id === null ? "storefront-outline" : "store-outline"}
                      size={18}
                      color={selected ? palette.cash : palette.textMuted}
                    />
                    <Text numberOfLines={1} style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>
                      {option.name}
                    </Text>
                    {selected ? <MaterialCommunityIcons name="check" size={18} color={palette.cash} /> : null}
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

function HistoryFilterControls({
  filter,
  range,
  totalCashAmount,
  totalUpiAmount,
  totalAmount,
  palette,
  onChange,
}: {
  filter: ExpenseHistoryFilterDraft;
  range: ExpenseHistoryRange;
  totalCashAmount?: string;
  totalUpiAmount?: string;
  totalAmount: string;
  palette: ReturnType<typeof useAdminTheme>["palette"];
  onChange: (filter: ExpenseHistoryFilterDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const todayValue = useMemo(() => toDateInputValue(new Date()), []);
  const [pickerInterval, setPickerInterval] = useState<ExpenseHistoryFilterDraft["interval"]>(filter.interval);
  const [calendarMonthValue, setCalendarMonthValue] = useState(() => filter.date || todayValue);
  const [draftRangeStartDate, setDraftRangeStartDate] = useState<string | null>(() => filter.startDate || todayValue);
  const [draftRangeEndDate, setDraftRangeEndDate] = useState<string | null>(() => filter.endDate || todayValue);
  const selectedOption = EXPENSE_HISTORY_INTERVAL_OPTIONS.find((option) => option.key === filter.interval)
    ?? EXPENSE_HISTORY_INTERVAL_OPTIONS[0];
  const updateFilter = (patch: Partial<ExpenseHistoryFilterDraft>) => onChange({ ...filter, ...patch });
  const calendarDays = useMemo(() => buildExpenseCalendarDays(calendarMonthValue), [calendarMonthValue]);
  const calendarMonthLabel = useMemo(
    () => expenseCalendarMonthFormatter.format(parseExpenseLocalDateValue(calendarMonthValue)),
    [calendarMonthValue],
  );
  const canApplyDraftRange = Boolean(draftRangeStartDate && draftRangeEndDate);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const monthOptions = useMemo(
    () => buildMonthOptions().map((option) => ({ ...option, value: option.value.slice(0, 7) })),
    [],
  );
  const yearOptions = useMemo(
    () => buildYearOptions().map((option) => ({ ...option, value: option.value.slice(0, 4) })),
    [],
  );

  const intervalModes: { key: ExpenseHistoryFilterDraft["interval"]; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "date", label: "Day" },
    { key: "range", label: "Range" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
    { key: "all", label: "Total" },
  ];
  const referenceOptions = (() => {
    if (pickerInterval === "week") {
      return weekOptions;
    }
    if (pickerInterval === "month") {
      return monthOptions;
    }
    if (pickerInterval === "year") {
      return yearOptions;
    }
    return [];
  })();
  const selectedReferenceValue =
    pickerInterval === "week"
      ? (weekOptions.some((option) => option.value === filter.weekDate) ? filter.weekDate : weekOptions[0]?.value)
      : pickerInterval === "month"
        ? (monthOptions.some((option) => option.value === filter.month) ? filter.month : monthOptions[0]?.value)
        : pickerInterval === "year"
          ? (yearOptions.some((option) => option.value === filter.year) ? filter.year : yearOptions[0]?.value)
          : null;
  const selectedReferenceLabel = selectedReferenceValue
    ? referenceOptions.find((option) => option.value === selectedReferenceValue)?.label ?? selectedReferenceValue
    : null;
  const intervalValueLabel = selectedReferenceLabel
    ? `${selectedOption.label} · ${selectedReferenceLabel}`
    : selectedOption.label;

  useEffect(() => {
    if (!open) {
      setPickerInterval(filter.interval);
    }
  }, [filter.interval, open]);

  useEffect(() => {
    if (filter.interval === "range") {
      setDraftRangeStartDate(filter.startDate || todayValue);
      setDraftRangeEndDate(filter.endDate || todayValue);
      setCalendarMonthValue(filter.startDate || todayValue);
      return;
    }
    if (filter.interval === "date") {
      setCalendarMonthValue(filter.date || todayValue);
    }
  }, [filter.date, filter.endDate, filter.interval, filter.startDate, todayValue]);

  const openIntervalPicker = () => {
    triggerHaptic();
    setPickerInterval(filter.interval);
    if (filter.interval === "range") {
      setDraftRangeStartDate(filter.startDate || todayValue);
      setDraftRangeEndDate(filter.endDate || todayValue);
      setCalendarMonthValue(filter.startDate || todayValue);
    } else {
      setCalendarMonthValue(filter.date || todayValue);
    }
    setOpen(true);
  };

  const handleSelectIntervalMode = (mode: ExpenseHistoryFilterDraft["interval"]) => {
    triggerHaptic();
    setPickerInterval(mode);
    if (mode === "date") {
      const date = filter.date || draftRangeStartDate || todayValue;
      setCalendarMonthValue(date);
      updateFilter({ interval: "date", date });
      return;
    }

    if (mode !== "range") {
      if (mode === "week") {
        const weekDate = weekOptions.some((option) => option.value === filter.weekDate)
          ? filter.weekDate
          : weekOptions[0]?.value ?? todayValue;
        updateFilter({ interval: mode, weekDate });
        return;
      }
      if (mode === "month") {
        const month = monthOptions.some((option) => option.value === filter.month)
          ? filter.month
          : monthOptions[0]?.value ?? todayValue.slice(0, 7);
        updateFilter({ interval: mode, month });
        return;
      }
      if (mode === "year") {
        const year = yearOptions.some((option) => option.value === filter.year)
          ? filter.year
          : yearOptions[0]?.value ?? todayValue.slice(0, 4);
        updateFilter({ interval: mode, year });
        return;
      }
      updateFilter({ interval: mode });
      setOpen(false);
      return;
    }

    const startDate = filter.startDate || filter.date || todayValue;
    const endDate = filter.endDate || filter.date || startDate;
    setDraftRangeStartDate(startDate);
    setDraftRangeEndDate(endDate);
    setCalendarMonthValue(startDate);
    updateFilter({ interval: "range", startDate, endDate });
    return;
  };

  const handleSelectReferenceOption = (value: string) => {
    triggerHaptic();
    if (pickerInterval === "week") {
      updateFilter({ interval: "week", weekDate: value });
    } else if (pickerInterval === "month") {
      updateFilter({ interval: "month", month: value });
    } else if (pickerInterval === "year") {
      updateFilter({ interval: "year", year: value });
    }
    setOpen(false);
  };

  const handleSelectCalendarDate = (value: string) => {
    triggerHaptic();
    if (pickerInterval === "date") {
      setCalendarMonthValue(value);
      updateFilter({ interval: "date", date: value });
      setOpen(false);
      return;
    }

    setDraftRangeStartDate((currentStart) => {
      if (!currentStart || draftRangeEndDate) {
        setDraftRangeEndDate(null);
        return value;
      }
      if (value < currentStart) {
        setDraftRangeEndDate(currentStart);
        return value;
      }
      setDraftRangeEndDate(value);
      return currentStart;
    });
  };

  const applyExpenseRange = () => {
    if (!draftRangeStartDate || !draftRangeEndDate) {
      return;
    }
    triggerHaptic();
    updateFilter({
      interval: "range",
      date: draftRangeStartDate,
      startDate: draftRangeStartDate,
      endDate: draftRangeEndDate,
    });
    setOpen(false);
  };

  const showPreviousCalendarMonth = () => {
    triggerHaptic();
    setCalendarMonthValue((value) => addExpenseCalendarMonths(value, -1));
  };

  const showNextCalendarMonth = () => {
    triggerHaptic();
    setCalendarMonthValue((value) => addExpenseCalendarMonths(value, 1));
  };

  const showCalendarGrid = pickerInterval === "date" || pickerInterval === "range";
  const showReferenceDropdown = pickerInterval === "week" || pickerInterval === "month" || pickerInterval === "year";

  return (
    <View style={styles.historyControls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select history interval"
        onPress={openIntervalPicker}
        style={[styles.dropdownSelect, { backgroundColor: palette.card, borderColor: palette.border }]}
      >
        <View style={styles.dropdownTextWrap}>
          <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>Interval</Text>
          <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
            {intervalValueLabel}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={selectedOption.icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
          size={20}
          color={palette.cash}
        />
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.dropdownOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.dropdownSheet, styles.historyIntervalSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.dropdownSheetHeader}>
              <Text style={[styles.dropdownSheetTitle, { color: palette.textPrimary }]}>Select interval</Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.dropdownClose}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.historySegmentRow}>
              {intervalModes.map((mode) => {
                const selected = mode.key === pickerInterval;
                return (
                  <Pressable
                    key={mode.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => handleSelectIntervalMode(mode.key)}
                    style={[
                      styles.historySegmentButton,
                      {
                        backgroundColor: selected ? palette.cash : palette.surfaceMuted,
                        borderColor: selected ? palette.cash : palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.historySegmentText, { color: selected ? palette.onCash : palette.textSecondary }]}>
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {showCalendarGrid ? (
              <ScrollView
                style={styles.historyPickerScroll}
                contentContainerStyle={styles.historyCalendarContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.historyCalendarHeader}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                    onPress={showPreviousCalendarMonth}
                    style={[
                      styles.historyCalendarIconButton,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                    ]}
                  >
                    <MaterialCommunityIcons name="chevron-left" size={22} color={palette.textSecondary} />
                  </Pressable>
                  <View style={styles.historyCalendarTitleWrap}>
                    <Text style={[styles.historyCalendarModeLabel, { color: palette.textMuted }]}>
                      {pickerInterval === "range" ? "Custom range" : "Select day"}
                    </Text>
                    <Text style={[styles.historyCalendarMonthTitle, { color: palette.textPrimary }]}>
                      {calendarMonthLabel}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                    onPress={showNextCalendarMonth}
                    style={[
                      styles.historyCalendarIconButton,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                    ]}
                  >
                    <MaterialCommunityIcons name="chevron-right" size={22} color={palette.textSecondary} />
                  </Pressable>
                </View>

                <View style={styles.historyWeekdayRow}>
                  {EXPENSE_CALENDAR_WEEKDAYS.map((weekday) => (
                    <Text key={weekday} style={[styles.historyWeekdayText, { color: palette.textMuted }]}>
                      {weekday}
                    </Text>
                  ))}
                </View>

                <View style={styles.historyCalendarGrid}>
                  {calendarDays.map((day) => {
                    const isDaySelected = pickerInterval === "date" && day.value === filter.date;
                    const isRangeStart = pickerInterval === "range" && day.value === draftRangeStartDate;
                    const isRangeEnd = pickerInterval === "range" && day.value === draftRangeEndDate;
                    const isRangeEdge = isRangeStart || isRangeEnd;
                    const isRangeMiddle =
                      pickerInterval === "range"
                      && isExpenseDateBetween(day.value, draftRangeStartDate, draftRangeEndDate)
                      && !isRangeEdge;
                    const isSelected = isDaySelected || isRangeEdge;
                    const isToday = day.value === todayValue;

                    return (
                      <View key={day.value} style={styles.historyCalendarDayCell}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={formatExpenseCalendarDateLabel(day.value)}
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => handleSelectCalendarDate(day.value)}
                          style={[
                            styles.historyCalendarDayButton,
                            {
                              backgroundColor: isSelected
                                ? palette.cash
                                : isRangeMiddle
                                  ? palette.cashSoft
                                  : "transparent",
                              borderColor: isToday ? palette.cash : "transparent",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.historyCalendarDayText,
                              {
                                color: isSelected
                                  ? palette.onCash
                                  : !day.inMonth
                                    ? palette.textMuted
                                    : isRangeMiddle || isToday
                                      ? palette.cash
                                      : palette.textPrimary,
                                opacity: day.inMonth || isSelected || isRangeMiddle ? 1 : 0.5,
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

                {pickerInterval === "range" ? (
                  <View
                    style={[
                      styles.historyRangeFooter,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                    ]}
                  >
                    <View style={styles.historyRangeDatesRow}>
                      <View style={styles.historyRangeDateBlock}>
                        <Text style={[styles.historyRangeDateLabel, { color: palette.textMuted }]}>Start</Text>
                        <Text style={[styles.historyRangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                          {formatExpenseCalendarDateLabel(draftRangeStartDate)}
                        </Text>
                      </View>
                      <View style={[styles.historyRangeDivider, { backgroundColor: palette.border }]} />
                      <View style={styles.historyRangeDateBlock}>
                        <Text style={[styles.historyRangeDateLabel, { color: palette.textMuted }]}>End</Text>
                        <Text style={[styles.historyRangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                          {formatExpenseCalendarDateLabel(draftRangeEndDate)}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Apply expense history range"
                      disabled={!canApplyDraftRange}
                      onPress={applyExpenseRange}
                      style={[
                        styles.historyRangeApplyButton,
                        { backgroundColor: canApplyDraftRange ? palette.cash : palette.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.historyRangeApplyText,
                          { color: canApplyDraftRange ? palette.onCash : palette.textMuted },
                        ]}
                      >
                        Apply Range
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </ScrollView>
            ) : showReferenceDropdown ? (
              <ScrollView
                style={styles.historyPickerScroll}
                contentContainerStyle={styles.historyReferenceOptionList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {referenceOptions.map((option) => {
                  const selected = option.value === selectedReferenceValue;
                  const subtitle = formatExpenseReferenceSubtitle(pickerInterval, option.value);
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => handleSelectReferenceOption(option.value)}
                      style={[
                        styles.dropdownOption,
                        {
                          backgroundColor: selected ? palette.cashSoft : palette.surfaceMuted,
                          borderColor: selected ? palette.cash : palette.border,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={pickerInterval === "week" ? "calendar-week" : pickerInterval === "month" ? "calendar-month" : "calendar-blank"}
                        size={18}
                        color={selected ? palette.cash : palette.textMuted}
                      />
                      <View style={styles.dropdownOptionTextWrap}>
                        <Text numberOfLines={1} style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>
                          {option.label}
                        </Text>
                        <Text numberOfLines={1} style={[styles.historyReferenceOptionSubtitle, { color: palette.textMuted }]}>
                          {subtitle}
                        </Text>
                      </View>
                      {selected ? <MaterialCommunityIcons name="check" size={18} color={palette.cash} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[styles.historyQuickFilterPanel, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                <MaterialCommunityIcons
                  name={filter.interval === "all" ? "sigma" : "calendar-today"}
                  size={20}
                  color={palette.cash}
                />
                <Text style={[styles.historyQuickFilterText, { color: palette.textSecondary }]}>
                  {filter.interval === "all"
                    ? "Showing complete expense history."
                    : "Showing today's expense history."}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <View style={[styles.totalPanel, { backgroundColor: palette.cashSoft, borderColor: palette.cash }]}>
        <View style={styles.rowBody}>
          <Text style={[styles.totalLabel, { color: palette.textMuted }]}>Total for {range.isValid ? range.label : selectedOption.label}</Text>
          {!range.isValid ? (
            <Text style={[styles.totalHint, { color: palette.danger }]}>{range.validationMessage}</Text>
          ) : (
            <Text style={[styles.totalHint, { color: palette.textSecondary }]}>Filtered expense amount</Text>
          )}
          <Text style={[styles.totalHint, { color: palette.textSecondary }]}>
            Cash {formatCurrency(totalCashAmount ?? "0")} | UPI {formatCurrency(totalUpiAmount ?? "0")}
          </Text>
        </View>
        <Text style={[styles.totalAmount, { color: palette.cash }]}>{formatCurrency(totalAmount)}</Text>
      </View>
    </View>
  );
}

function ExpenseItemRow({
  item,
  palette,
  onEdit,
  onDelete,
}: {
  item: ExpenseItemRead;
  palette: ReturnType<typeof useAdminTheme>["palette"];
  onEdit: (item: ExpenseItemRead) => void;
  onDelete: (item: ExpenseItemRead) => void;
}) {
  const thumbnailUri = getItemThumbnailUri(item);
  return (
    <View
      style={[
        styles.expenseItemCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.expenseItemMain}>
        <ItemThumbnail
          uri={thumbnailUri}
          recyclingKey={item.id}
          size={46}
          borderRadius={14}
          backgroundColor={palette.cashSoft}
          borderColor={palette.border}
          icon="cash-minus"
          iconColor={palette.cash}
        />
        <View style={styles.expenseItemBody}>
          <View style={styles.expenseItemTitleLine}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}>{item.name}</Text>
            <View style={[styles.statusPill, { backgroundColor: item.is_active ? palette.successSoft : palette.dangerSoft }]}>
              <Text style={[styles.statusText, { color: item.is_active ? palette.success : palette.danger }]}>
                {item.is_active ? "Active" : "Paused"}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
        </View>
      </View>
      <View style={[styles.expenseItemFooter, { borderTopColor: palette.border }]}>
        <Text numberOfLines={1} style={[styles.expenseItemMetaText, { color: palette.textMuted }]}>
          {formatCount(item.allocated_shop_count, "branch")} · {formatCount(item.entry_count, "entry")}
        </Text>
        <View style={styles.expenseItemActionGroup}>
          <IconButton label="Edit expense item" icon="pencil-outline" tone={palette.cash} onPress={() => onEdit(item)} />
        </View>
      </View>
    </View>
  );
}

function AllocationRow({
  item,
  palette,
  busy,
  onToggle,
  onRemove,
}: {
  item: ShopExpenseItemRead;
  palette: ReturnType<typeof useAdminTheme>["palette"];
  busy: boolean;
  onToggle: (item: ShopExpenseItemRead) => void;
  onRemove: (item: ShopExpenseItemRead) => void;
}) {
  const thumbnailUri = getItemThumbnailUri(item);
  return (
    <View
      style={[
        styles.expenseItemCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.expenseItemMain}>
        <ItemThumbnail
          uri={thumbnailUri}
          recyclingKey={item.id}
          size={46}
          borderRadius={14}
          backgroundColor={item.allocation_is_active ? palette.cashSoft : palette.dangerSoft}
          borderColor={palette.border}
          icon={item.allocation_is_active ? "cash-check" : "cash-remove"}
          iconColor={item.allocation_is_active ? palette.cash : palette.danger}
        />
        <View style={styles.expenseItemBody}>
          <View style={styles.expenseItemTitleLine}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}>{item.name}</Text>
            <View style={[styles.statusPill, { backgroundColor: item.allocation_is_active ? palette.successSoft : palette.dangerSoft }]}>
              <Text style={[styles.statusText, { color: item.allocation_is_active ? palette.success : palette.danger }]}>
                {item.allocation_is_active ? "Usable" : "Hidden"}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
        </View>
      </View>
      <View style={[styles.expenseItemFooter, { borderTopColor: palette.border }]}>
        <Text numberOfLines={1} style={[styles.expenseItemMetaText, { color: palette.textMuted }]}>
          Order {item.allocation_sort_order} · {formatCount(item.entry_count, "entry")}
        </Text>
        <View style={styles.expenseItemActionGroup}>
          <IconButton
            label={item.allocation_is_active ? "Pause expense allocation" : "Resume expense allocation"}
            icon={item.allocation_is_active ? "pause-circle-outline" : "play-circle-outline"}
            tone={item.allocation_is_active ? palette.textSecondary : palette.success}
            loading={busy}
            onPress={() => onToggle(item)}
          />
          <IconButton
            label="Remove expense allocation"
            icon="link-off"
            tone={palette.danger}
            loading={busy}
            onPress={() => onRemove(item)}
          />
        </View>
      </View>
    </View>
  );
}

function HistoryRow({
  entry,
  palette,
  onEdit,
  busy = false,
}: {
  entry: ExpenseEntryRead;
  palette: ReturnType<typeof useAdminTheme>["palette"];
  onEdit: (entry: ExpenseEntryRead) => void;
  busy?: boolean;
}) {
  const imageUri = getItemThumbnailUri(entry);
  const split = expenseEntrySplit(entry);
  return (
    <View style={[styles.rowCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <ItemThumbnail
        uri={imageUri}
        recyclingKey={`${entry.id}:${entry.expense_item_id}`}
        size={42}
        borderRadius={13}
        backgroundColor={palette.cashSoft}
        borderColor={palette.border}
        icon="receipt-text-clock-outline"
        iconColor={palette.cash}
        iconSize={20}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.textPrimary }]}>{entry.expense_name}</Text>
          <Text style={[styles.amountText, { color: palette.cash }]}>{formatCurrency(split.total)}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: palette.textSecondary }]}>
          {entry.shop_name} · {entry.expense_tamil_name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textMuted }]}>
          Cash {formatCurrency(split.cash)} | UPI {formatCurrency(split.upi)}
        </Text>
        <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textMuted }]}>
          {formatDateTime(entry.spent_at)}{entry.note ? ` · ${entry.note}` : ""}
        </Text>
      </View>
      <View style={styles.historyRowAction}>
        <IconButton
          label="Edit expense history entry"
          icon="pencil-outline"
          tone={palette.cash}
          loading={busy}
          onPress={() => onEdit(entry)}
        />
      </View>
    </View>
  );
}

export function AdminExpensesScreen({ navigation, route }: AdminExpensesScreenProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme, palette } = useAdminTheme();
  const [activeTab, setActiveTab] = useState<ExpenseTab>("items");
  const [shops, setShops] = useState<ShopRead[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(route.params?.shopId ?? null);
  const selectedShop = useSelectedShop(shops, selectedShopId);

  const [itemSearch, setItemSearch] = useState("");
  const debouncedItemSearch = useDebouncedValue(itemSearch.trim());
  const [itemRows, setItemRows] = useState<ExpenseItemRead[]>([]);
  const [itemCounts, setItemCounts] = useState<ExpenseItemCounts>(EMPTY_COUNTS);
  const [itemCursor, setItemCursor] = useState<CursorState>(EMPTY_CURSOR);
  const [itemHasMore, setItemHasMore] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsLoadingMore, setItemsLoadingMore] = useState(false);

  const [candidateSearch, setCandidateSearch] = useState("");
  const debouncedCandidateSearch = useDebouncedValue(candidateSearch.trim());
  const [candidateRows, setCandidateRows] = useState<ExpenseItemRead[]>([]);
  const [allocationRows, setAllocationRows] = useState<ShopExpenseItemRead[]>([]);
  const [allocationCursor, setAllocationCursor] = useState<CursorState>(EMPTY_CURSOR);
  const [allocationHasMore, setAllocationHasMore] = useState(false);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationLoadingMore, setAllocationLoadingMore] = useState(false);
  const [allocationBusyId, setAllocationBusyId] = useState<UUID | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<UUID>>(() => new Set());
  const [importingCandidates, setImportingCandidates] = useState(false);

  const [historyRows, setHistoryRows] = useState<ExpenseEntryRead[]>([]);
  const [historyFilter, setHistoryFilter] = useState<ExpenseHistoryFilterDraft>(() => createExpenseHistoryFilterDraft());
  const historyRange = useMemo(() => buildExpenseHistoryRange(historyFilter), [historyFilter]);
  const [historyTotalAmount, setHistoryTotalAmount] = useState("0.00");
  const [historyTotalCashAmount, setHistoryTotalCashAmount] = useState("0.00");
  const [historyTotalUpiAmount, setHistoryTotalUpiAmount] = useState("0.00");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<{ spentAt: string | null; id: UUID | null }>({
    spentAt: null,
    id: null,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyEditorOpen, setHistoryEditorOpen] = useState(false);
  const [editingHistoryEntry, setEditingHistoryEntry] = useState<ExpenseEntryRead | null>(null);
  const [historyAmountDraft, setHistoryAmountDraft] = useState("");
  const [historyDateDraft, setHistoryDateDraft] = useState("");
  const [historyDatePickerOpen, setHistoryDatePickerOpen] = useState(false);
  const [historyTimeDraft, setHistoryTimeDraft] = useState("");
  const [historyTimePickerOpen, setHistoryTimePickerOpen] = useState(false);
  const [historyNoteDraft, setHistoryNoteDraft] = useState("");
  const [savingHistoryEntry, setSavingHistoryEntry] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState<UUID | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ExpenseItemRead | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [tamilNameDraft, setTamilNameDraft] = useState("");
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState(true);
  const [savingItem, setSavingItem] = useState(false);

  const listPaddingBottom = 30 + insets.bottom;

  const loadShops = useCallback(async () => {
    const loadedShops = await fetchShops();
    setShops(loadedShops);
    setSelectedShopId((current) => current ?? loadedShops[0]?.id ?? null);
  }, []);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    setErrorMessage(null);
    try {
      const [page, counts] = await Promise.all([
        fetchExpenseItemRows({ q: debouncedItemSearch, limit: PAGE_LIMIT }),
        fetchExpenseItemCounts({ q: debouncedItemSearch }),
      ]);
      setItemRows(page.items);
      setItemCounts(counts);
      setItemCursor(pageCursor(page));
      setItemHasMore(page.has_more);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load expense items."));
    } finally {
      setItemsLoading(false);
    }
  }, [debouncedItemSearch]);

  const loadMoreItems = useCallback(async () => {
    if (!itemHasMore || itemsLoading || itemsLoadingMore) {
      return;
    }
    setItemsLoadingMore(true);
    try {
      const page = await fetchExpenseItemRows({
        q: debouncedItemSearch,
        limit: PAGE_LIMIT,
        cursor_sort_order: itemCursor.sortOrder,
        cursor_name: itemCursor.name,
        cursor_id: itemCursor.id,
      });
      setItemRows((current) => mergeById(current, page.items));
      setItemCursor(pageCursor(page));
      setItemHasMore(page.has_more);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load more expense items."));
    } finally {
      setItemsLoadingMore(false);
    }
  }, [debouncedItemSearch, itemCursor, itemHasMore, itemsLoading, itemsLoadingMore]);

  const loadAllocation = useCallback(async () => {
    if (!selectedShop) {
      setAllocationRows([]);
      setCandidateRows([]);
      setSelectedCandidateIds(new Set());
      return;
    }
    setAllocationLoading(true);
    setErrorMessage(null);
    try {
      const [allocationPage, candidatePage] = await Promise.all([
        fetchShopExpenseItemRows(selectedShop.id, { limit: PAGE_LIMIT }),
        fetchShopExpenseItemCandidateRows(selectedShop.id, {
          q: debouncedCandidateSearch,
          limit: CANDIDATE_LIMIT,
        }),
      ]);
      setAllocationRows(allocationPage.items);
      setAllocationCursor(pageCursor(allocationPage));
      setAllocationHasMore(allocationPage.has_more);
      setCandidateRows(candidatePage.items);
      setSelectedCandidateIds(new Set());
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load branch expenses."));
    } finally {
      setAllocationLoading(false);
    }
  }, [debouncedCandidateSearch, selectedShop]);

  const loadMoreAllocation = useCallback(async () => {
    if (!selectedShop || !allocationHasMore || allocationLoading || allocationLoadingMore) {
      return;
    }
    setAllocationLoadingMore(true);
    try {
      const page = await fetchShopExpenseItemRows(selectedShop.id, {
        limit: PAGE_LIMIT,
        cursor_sort_order: allocationCursor.sortOrder,
        cursor_name: allocationCursor.name,
        cursor_id: allocationCursor.id,
      });
      setAllocationRows((current) => mergeById(current, page.items));
      setAllocationCursor(pageCursor(page));
      setAllocationHasMore(page.has_more);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load more branch expenses."));
    } finally {
      setAllocationLoadingMore(false);
    }
  }, [allocationCursor, allocationHasMore, allocationLoading, allocationLoadingMore, selectedShop]);

  const loadHistory = useCallback(async () => {
    if (!historyRange.isValid) {
      setHistoryRows([]);
      setHistoryHasMore(false);
      setHistoryTotalAmount("0.00");
      setHistoryTotalCashAmount("0.00");
      setHistoryTotalUpiAmount("0.00");
      setHistoryCursor({ spentAt: null, id: null });
      return;
    }
    setHistoryLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchAdminExpenseHistory({
        shop_id: activeTab === "history" ? selectedShopId : null,
        range_start_date: historyRange.rangeStartDate,
        range_end_date: historyRange.rangeEndDate,
        limit: PAGE_LIMIT,
      });
      setHistoryRows(page.items);
      setHistoryHasMore(page.has_more);
      setHistoryTotalCashAmount(page.total_cash_amount ?? "0.00");
      setHistoryTotalUpiAmount(page.total_upi_amount ?? "0.00");
      setHistoryTotalAmount(page.total_amount);
      setHistoryCursor({
        spentAt: page.next_cursor_spent_at ?? null,
        id: page.next_cursor_id ?? null,
      });
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load expense history."));
    } finally {
      setHistoryLoading(false);
    }
  }, [activeTab, historyRange.isValid, historyRange.rangeEndDate, historyRange.rangeStartDate, selectedShopId]);

  const loadMoreHistory = useCallback(async () => {
    if (!historyRange.isValid || !historyHasMore || historyLoading || historyLoadingMore) {
      return;
    }
    setHistoryLoadingMore(true);
    try {
      const page = await fetchAdminExpenseHistory({
        shop_id: selectedShopId,
        range_start_date: historyRange.rangeStartDate,
        range_end_date: historyRange.rangeEndDate,
        limit: PAGE_LIMIT,
        cursor_spent_at: historyCursor.spentAt,
        cursor_id: historyCursor.id,
      });
      setHistoryRows((current) => mergeById(current, page.items));
      setHistoryHasMore(page.has_more);
      setHistoryTotalCashAmount(page.total_cash_amount ?? "0.00");
      setHistoryTotalUpiAmount(page.total_upi_amount ?? "0.00");
      setHistoryTotalAmount(page.total_amount);
      setHistoryCursor({
        spentAt: page.next_cursor_spent_at ?? null,
        id: page.next_cursor_id ?? null,
      });
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load more expense history."));
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [
    historyCursor,
    historyHasMore,
    historyLoading,
    historyLoadingMore,
    historyRange.isValid,
    historyRange.rangeEndDate,
    historyRange.rangeStartDate,
    selectedShopId,
  ]);

  const refreshCurrentTab = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === "items") {
        await loadItems();
      } else if (activeTab === "allocation") {
        await loadAllocation();
      } else {
        await loadHistory();
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, loadAllocation, loadHistory, loadItems]);

  useEffect(() => {
    void loadShops();
  }, [loadShops]);

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems])
  );

  useEffect(() => {
    if (activeTab === "allocation") {
      void loadAllocation();
    }
  }, [activeTab, loadAllocation]);

  useEffect(() => {
    if (activeTab === "history") {
      void loadHistory();
    }
  }, [activeTab, loadHistory]);

  const openCreateEditor = useCallback(() => {
    navigation.navigate("AdminExpenseItemEditor");
  }, [navigation]);

  const openEditEditor = useCallback((item: ExpenseItemRead) => {
    navigation.navigate("AdminExpenseItemEditor", { initialItem: item });
  }, [navigation]);

  const closeEditor = useCallback(() => {
    if (savingItem) {
      return;
    }
    void deleteImageDraftFile(imageDraft);
    setImageDraft(null);
    setRemoveImageRequested(false);
    setImageError(null);
    setImageStatus(null);
    setEditorOpen(false);
  }, [imageDraft, savingItem]);

  const openHistoryEditor = useCallback((entry: ExpenseEntryRead) => {
    setEditingHistoryEntry(entry);
    setHistoryAmountDraft(entry.amount);
    setHistoryDateDraft(entrySpentAtDateValue(entry.spent_at));
    setHistoryTimeDraft(entrySpentAtTimeValue(entry.spent_at));
    setHistoryNoteDraft(entry.note ?? "");
    setHistoryEditorOpen(true);
  }, []);

  const closeHistoryEditor = useCallback(() => {
    if (savingHistoryEntry) {
      return;
    }
    setHistoryEditorOpen(false);
    setEditingHistoryEntry(null);
  }, [savingHistoryEntry]);

  const saveHistoryEntry = useCallback(async () => {
    if (!editingHistoryEntry) {
      return;
    }
    if (!isValidExpenseAmount(historyAmountDraft)) {
      Alert.alert("Check amount", "Enter a valid rupee amount with up to 2 decimals.");
      return;
    }
    const spentAt = buildSpentAtPayload(historyDateDraft, historyTimeDraft);
    if (!spentAt) {
      Alert.alert("Check date", "Enter a valid spent date and time.");
      return;
    }
    setSavingHistoryEntry(true);
    setHistoryBusyId(editingHistoryEntry.id);
    try {
      await updateAdminExpenseEntry(editingHistoryEntry.id, {
        amount: Number(historyAmountDraft).toFixed(2),
        spent_at: spentAt,
        note: historyNoteDraft.trim() || null,
      });
      setHistoryEditorOpen(false);
      setEditingHistoryEntry(null);
      await loadHistory();
    } catch (error) {
      Alert.alert("Save failed", formatApiErrorMessage(error, "Unable to save expense history entry."));
    } finally {
      setSavingHistoryEntry(false);
      setHistoryBusyId(null);
    }
  }, [
    editingHistoryEntry,
    historyAmountDraft,
    historyDateDraft,
    historyNoteDraft,
    historyTimeDraft,
    loadHistory,
  ]);

  const hasStoredImage = Boolean(editingItem?.image_path || editingItem?.image_thumb_path);
  const currentImageUri = removeImageRequested
    ? ""
    : imageDraft?.uri ?? (editingItem ? getItemThumbnailUri(editingItem) : "");

  const pickImage = useCallback(async () => {
    setImageError(null);
    setImageStatus("Opening image picker...");
    const imagePicker = await loadImagePickerModule();
    if (!imagePicker) {
      setImageStatus(null);
      setImageError("Image picker is not available in this app build.");
      return;
    }
    try {
      const result = await imagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.72,
      });
      if (result.canceled || !result.assets[0]) {
        setImageStatus(null);
        return;
      }
      const draft = await prepareImageDraftForUpload(result.assets[0]);
      void deleteImageDraftFile(imageDraft);
      setImageDraft(draft);
      setRemoveImageRequested(false);
      setImageError(null);
      setImageStatus("Ready to upload when you save.");
    } catch (error) {
      setImageStatus(null);
      setImageError(error instanceof Error && error.message ? error.message : "Unable to pick image.");
    }
  }, [imageDraft]);

  const removeImage = useCallback(() => {
    if (imageDraft) {
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      setImageError(null);
      setImageStatus(null);
      return;
    }
    if (removeImageRequested) {
      setRemoveImageRequested(false);
      setImageError(null);
      setImageStatus(null);
      return;
    }
    if (hasStoredImage) {
      setRemoveImageRequested(true);
      setImageError(null);
      setImageStatus("Stored image will be removed when you save.");
    }
  }, [hasStoredImage, imageDraft, removeImageRequested]);

  const saveExpenseItem = useCallback(async () => {
    const name = nameDraft.trim();
    const tamilName = tamilNameDraft.trim();
    const sortOrder = editingItem?.sort_order ?? 0;
    if (name.length < 2 || !tamilName) {
      Alert.alert("Check expense item", "Enter name and Tamil name.");
      return;
    }
    setSavingItem(true);
    try {
      if (editingItem) {
        await updateExpenseItem(editingItem.id, {
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
        });
        if (imageDraft) {
          await replaceExpenseItemImageFile(editingItem.id, imageDraft);
        } else if (removeImageRequested && hasStoredImage) {
          await deleteExpenseItemImage(editingItem.id);
        }
      } else {
        const createdItem = await createExpenseItem({
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
        });
        if (imageDraft) {
          try {
            await replaceExpenseItemImageFile(createdItem.id, imageDraft);
          } catch (error) {
            await deleteExpenseItem(createdItem.id).catch(() => undefined);
            throw error;
          }
        }
      }
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      setRemoveImageRequested(false);
      setImageError(null);
      setImageStatus(null);
      setEditorOpen(false);
      await loadItems();
      if (activeTab === "allocation") {
        await loadAllocation();
      }
    } catch (error) {
      Alert.alert("Save failed", formatApiErrorMessage(error, "Unable to save expense item."));
    } finally {
      setSavingItem(false);
    }
  }, [
    activeDraft,
    activeTab,
    editingItem,
    hasStoredImage,
    imageDraft,
    loadAllocation,
    loadItems,
    nameDraft,
    removeImageRequested,
    tamilNameDraft,
  ]);

  const confirmDeleteItem = useCallback((item: ExpenseItemRead) => {
    Alert.alert(
      "Delete expense item?",
      `${item.name} can be deleted only if it has no allocation or history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteExpenseItem(item.id)
              .then(loadItems)
              .catch((error) => Alert.alert("Delete failed", formatApiErrorMessage(error)));
          },
        },
      ],
    );
  }, [loadItems]);

  const toggleCandidateSelection = useCallback((itemId: UUID) => {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const importSelectedCandidates = useCallback(async () => {
    if (!selectedShop || selectedCandidateIds.size === 0) {
      return;
    }
    setImportingCandidates(true);
    try {
      await allocateShopExpenseItems(selectedShop.id, [...selectedCandidateIds]);
      await loadAllocation();
      await loadItems();
    } catch (error) {
      Alert.alert("Import failed", formatApiErrorMessage(error, "Unable to import expense items."));
    } finally {
      setImportingCandidates(false);
    }
  }, [loadAllocation, loadItems, selectedCandidateIds, selectedShop]);

  const toggleAllocation = useCallback(async (item: ShopExpenseItemRead) => {
    if (!selectedShop) {
      return;
    }
    setAllocationBusyId(item.id);
    try {
      const updated = await updateShopExpenseAllocation(selectedShop.id, item.id, {
        is_active: !item.allocation_is_active,
      });
      setAllocationRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error) {
      Alert.alert("Update failed", formatApiErrorMessage(error, "Unable to update allocation."));
    } finally {
      setAllocationBusyId(null);
    }
  }, [selectedShop]);

  const removeAllocation = useCallback((item: ShopExpenseItemRead) => {
    if (!selectedShop) {
      return;
    }
    Alert.alert("Remove allocation?", `${item.name} will no longer be available to this branch.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setAllocationBusyId(item.id);
          void deallocateShopExpenseItem(selectedShop.id, item.id)
            .then(async () => {
              await loadAllocation();
              await loadItems();
            })
            .catch((error) => Alert.alert("Remove failed", formatApiErrorMessage(error)))
            .finally(() => setAllocationBusyId(null));
        },
      },
    ]);
  }, [loadAllocation, loadItems, selectedShop]);

  const renderHeader = () => (
    <>
      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}
    </>
  );

  const allocationHeader = () => (
    <View style={styles.listHeader}>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Branch allocation</Text>
      <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
        Shops can only record expenses from active items allocated here.
      </Text>
      <BranchDropdown
        shops={shops}
        selectedShopId={selectedShop?.id ?? null}
        onSelect={setSelectedShopId}
        palette={palette}
      />
      <View style={styles.headerActions}>
        <ActionButton
          label="Arrange order"
          icon="sort"
          palette={palette}
          tone="info"
          disabled={!selectedShop || allocationRows.length === 0}
          onPress={() => selectedShop && navigation.navigate("AdminShopExpensesOrder", {
            shopId: selectedShop.id,
            shopName: selectedShop.name,
          })}
        />
        <ActionButton
          label={selectedCandidateIds.size > 0 ? `Import (${selectedCandidateIds.size})` : "Import"}
          icon="tray-arrow-down"
          palette={palette}
          tone="success"
          active
          disabled={!selectedShop || selectedCandidateIds.size === 0}
          onPress={importSelectedCandidates}
        />
      </View>
      <View style={[styles.searchBox, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
        <TextInput
          value={candidateSearch}
          onChangeText={setCandidateSearch}
          placeholder="Search items to import"
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.textPrimary }]}
        />
      </View>
      <View style={styles.candidateWrap}>
        {candidateRows.length === 0 ? (
          <Text style={[styles.smallMuted, { color: palette.textMuted }]}>No unallocated expense items match this branch.</Text>
        ) : (
          candidateRows.map((item) => {
            const selected = selectedCandidateIds.has(item.id);
            const thumbnailUri = getItemThumbnailUri(item);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: importingCandidates }}
                onPress={() => toggleCandidateSelection(item.id)}
                disabled={importingCandidates}
                style={[
                  styles.candidateRow,
                  {
                    backgroundColor: selected ? palette.cashSoft : palette.surfaceMuted,
                    borderColor: selected ? palette.cash : palette.border,
                  },
                ]}
              >
                <ItemThumbnail
                  uri={thumbnailUri}
                  recyclingKey={item.id}
                  size={38}
                  borderRadius={12}
                  backgroundColor={palette.card}
                  borderColor={palette.border}
                  icon="cash-minus"
                  iconColor={palette.cash}
                  iconSize={18}
                />
                <View style={styles.rowBody}>
                  <Text numberOfLines={1} style={[styles.candidateTitle, { color: palette.textPrimary }]}>{item.name}</Text>
                  <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.textMuted }]}>{item.tamil_name}</Text>
                </View>
                <MaterialCommunityIcons
                  name={selected ? "checkbox-marked-circle-outline" : "checkbox-blank-circle-outline"}
                  size={21}
                  color={selected ? palette.cash : palette.textMuted}
                />
              </Pressable>
            );
          })
        )}
      </View>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
        Allocated to {selectedShop?.name ?? "branch"}
      </Text>
    </View>
  );

  const historyHeader = () => (
    <View style={styles.listHeader}>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Expense history</Text>
      <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
        View entries from every branch or filter to one branch.
      </Text>
      <BranchDropdown
        shops={shops}
        selectedShopId={selectedShopId}
        includeAll
        onSelect={setSelectedShopId}
        palette={palette}
      />
      <HistoryFilterControls
        filter={historyFilter}
        range={historyRange}
        totalCashAmount={historyTotalCashAmount}
        totalUpiAmount={historyTotalUpiAmount}
        totalAmount={historyTotalAmount}
        palette={palette}
        onChange={setHistoryFilter}
      />
    </View>
  );

  const itemsHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.headerActions}>
        <View style={styles.rowBody}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Expense items</Text>
          <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
            Independent from billing items. No price, unit, image, category, or checkout fields.
          </Text>
        </View>
        <ActionButton label="New item" icon="plus" palette={palette} tone="success" active onPress={openCreateEditor} />
      </View>
      <View style={[styles.searchBox, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
        <TextInput
          value={itemSearch}
          onChangeText={setItemSearch}
          placeholder="Search expense items"
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.textPrimary }]}
        />
      </View>
    </View>
  );

  const sortedItemRows = useMemo(() => {
    return [...itemRows].sort((a, b) => {
      if (a.is_active === b.is_active) return 0;
      return a.is_active ? -1 : 1;
    });
  }, [itemRows]);

  const content = (() => {
    if (activeTab === "items") {
      if (itemsLoading && itemRows.length === 0) {
        return <AdminLoadingState label="Loading expenses..." palette={palette} />;
      }
      return (
        <FlatList
          data={sortedItemRows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ExpenseItemRow item={item} palette={palette} onEdit={openEditEditor} onDelete={confirmDeleteItem} />
          )}
          ListHeaderComponent={<>{renderHeader()}{itemsHeader()}</>}
          ListEmptyComponent={<AdminEmptyState title="No expense items" description="Create the first expense item for branch use." palette={palette} />}
          ListFooterComponent={itemsLoadingMore ? <ActivityIndicator color={palette.cash} style={styles.footerLoader} /> : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCurrentTab} tintColor={palette.cash} />}
          onEndReached={loadMoreItems}
          onEndReachedThreshold={0.45}
          contentContainerStyle={[styles.listContent, { paddingBottom: listPaddingBottom }]}
        />
      );
    }

    if (activeTab === "allocation") {
      if (allocationLoading && allocationRows.length === 0) {
        return <AdminLoadingState label="Loading branch allocation..." palette={palette} />;
      }
      return (
        <FlatList
          data={allocationRows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AllocationRow
              item={item}
              palette={palette}
              busy={allocationBusyId === item.id}
              onToggle={toggleAllocation}
              onRemove={removeAllocation}
            />
          )}
          ListHeaderComponent={<>{renderHeader()}{allocationHeader()}</>}
          ListEmptyComponent={<AdminEmptyState title="No allocated expenses" description="Allocate expense items to this branch." palette={palette} />}
          ListFooterComponent={allocationLoadingMore ? <ActivityIndicator color={palette.cash} style={styles.footerLoader} /> : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCurrentTab} tintColor={palette.cash} />}
          onEndReached={loadMoreAllocation}
          onEndReachedThreshold={0.45}
          contentContainerStyle={[styles.listContent, { paddingBottom: listPaddingBottom }]}
        />
      );
    }

    if (historyLoading && historyRows.length === 0) {
      return <AdminLoadingState label="Loading expense history..." palette={palette} />;
    }
    return (
      <FlatList
        data={historyRows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <HistoryRow
            entry={item}
            palette={palette}
            onEdit={openHistoryEditor}
            busy={historyBusyId === item.id}
          />
        )}
        ListHeaderComponent={<>{renderHeader()}{historyHeader()}</>}
        ListEmptyComponent={<AdminEmptyState title="No expense history" description="Shop entries will appear here after they record expenses." palette={palette} />}
        ListFooterComponent={historyLoadingMore ? <ActivityIndicator color={palette.cash} style={styles.footerLoader} /> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCurrentTab} tintColor={palette.cash} />}
        onEndReached={loadMoreHistory}
        onEndReachedThreshold={0.45}
        contentContainerStyle={[styles.listContent, { paddingBottom: listPaddingBottom }]}
      />
    );
  })();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={[styles.topBar, { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.onShell }]}>Expenses</Text>
          <Text style={[styles.subtitle, { color: palette.onShellMuted }]}>Standalone branch expense control</Text>
        </View>
        <AdminHeaderActions refreshing={refreshing} onRefresh={refreshCurrentTab} />
      </View>

      <View style={[styles.tabs, { borderBottomColor: palette.border }]}>
        {TABS.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => {
                triggerHaptic();
                setActiveTab(tab.key);
              }}
              style={[
                styles.tabButton,
                {
                  backgroundColor: selected ? palette.cashSoft : palette.card,
                  borderColor: selected ? palette.cash : palette.border,
                },
              ]}
            >
              <MaterialCommunityIcons name={tab.icon} size={17} color={selected ? palette.cash : palette.textMuted} />
              <Text style={[styles.tabLabel, { color: selected ? palette.cash : palette.textPrimary }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {content}

      <Modal
        visible={historyEditorOpen}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={closeHistoryEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          style={[styles.centeredModalBackdrop, { backgroundColor: palette.overlay }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeHistoryEditor} />
          <View style={styles.centeredKeyboardWrap} pointerEvents="box-none">
            <View
              style={[
                styles.modalCard,
                adminElevation(3),
                { backgroundColor: palette.card },
              ]}
            >
              <View style={styles.modalHeader}>
                <View style={styles.rowBody}>
                  <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>Edit expense entry</Text>
                  {editingHistoryEntry ? (
                    <Text numberOfLines={2} style={[styles.rowMeta, { color: palette.textMuted }]}>
                      {editingHistoryEntry.shop_name} · {editingHistoryEntry.expense_name}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close expense history editor"
                  onPress={closeHistoryEditor}
                  style={[styles.modalCloseButton, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                <AdminTextField
                  label="Amount"
                  value={historyAmountDraft}
                  onChangeText={setHistoryAmountDraft}
                  placeholder="0.00"
                  palette={palette}
                  keyboardType="decimal-pad"
                />
                <CalendarDateField
                  label="Spent date"
                  value={historyDateDraft}
                  colors={palette}
                  onPress={() => setHistoryDatePickerOpen(true)}
                />
                <TimePickerField
                  label="Spent time"
                  value={historyTimeDraft}
                  colors={palette}
                  onPress={() => setHistoryTimePickerOpen(true)}
                />
                <AdminTextField
                  label="Note"
                  value={historyNoteDraft}
                  onChangeText={setHistoryNoteDraft}
                  placeholder="Optional note"
                  palette={palette}
                />
              </ScrollView>
              <View style={styles.modalActions}>
                <ActionButton label="Cancel" icon="close" palette={palette} tone="warning" onPress={closeHistoryEditor} />
                <ActionButton
                  label="Save changes"
                  icon="content-save-outline"
                  palette={palette}
                  tone="success"
                  active
                  disabled={savingHistoryEntry}
                  onPress={saveHistoryEntry}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CalendarDatePickerModal
        visible={historyDatePickerOpen}
        title="Select spent date"
        value={historyDateDraft}
        colors={palette}
        onSelect={(date) => {
          setHistoryDateDraft(date);
          setHistoryDatePickerOpen(false);
        }}
        onClose={() => setHistoryDatePickerOpen(false)}
      />

      <TimePickerModal
        visible={historyTimePickerOpen}
        title="Select spent time"
        value={historyTimeDraft}
        colors={palette}
        onSelect={(time) => {
          setHistoryTimeDraft(time);
          setHistoryTimePickerOpen(false);
        }}
        onClose={() => setHistoryTimePickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  adminButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  adminButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  actionButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
  },
  adminEmptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
  },
  adminEmptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  adminEmptyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  adminEmptyText: {
    maxWidth: 320,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  adminLoadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  adminLoadingIcon: {
    width: 68,
    height: 68,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  adminLoadingText: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  adminField: {
    gap: 8,
  },
  adminFieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  adminFieldInput: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: "800",
  },
  topBar: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  listContent: {
    gap: 12,
    padding: 16,
  },
  listHeader: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchBox: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
    fontWeight: "700",
  },
  countStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  countPill: {
    minWidth: 84,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  countValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  countLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  rowCard: {
    minHeight: 82,
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  historyRowAction: {
    alignSelf: "center",
    flexShrink: 0,
  },
  expenseItemCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 11,
  },
  expenseItemMain: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  expenseItemBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  expenseItemTitleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  expenseItemFooter: {
    minHeight: 42,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  expenseItemMetaText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  expenseItemActionGroup: {
    width: 100,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "space-between",
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    alignSelf: "stretch",
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  rowMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    gap: 6,
    justifyContent: "center",
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPill: {
    borderRadius: 999,
    flexShrink: 0,
    marginTop: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
  },
  amountText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  dropdownSelect: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  dropdownTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  dropdownLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  dropdownValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  dropdownOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  dropdownSheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  dropdownSheetHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  dropdownSheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  dropdownClose: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownOption: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  dropdownOptionList: {
    gap: 8,
  },
  dropdownOptionTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dropdownOptionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  historyControls: {
    gap: 9,
  },
  historyIntervalSheet: {
    maxHeight: "84%",
  },
  historySegmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  historySegmentButton: {
    flexGrow: 1,
    flexBasis: "30%",
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historySegmentText: {
    fontSize: 13,
    fontWeight: "700",
  },
  historyPickerScroll: {
    maxHeight: 430,
  },
  historyReferenceOptionList: {
    gap: 8,
  },
  historyReferenceOptionSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  historyCalendarContent: {
    paddingHorizontal: 0,
    paddingBottom: 0,
    gap: 12,
  },
  historyCalendarHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  historyCalendarIconButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCalendarTitleWrap: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
  },
  historyCalendarModeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  historyCalendarMonthTitle: {
    marginTop: 3,
    fontSize: 17,
    fontWeight: "800",
  },
  historyWeekdayRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  historyWeekdayText: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
  },
  historyCalendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  historyCalendarDayCell: {
    width: "14.2857%",
    padding: 2,
  },
  historyCalendarDayButton: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCalendarDayText: {
    fontSize: 14,
    fontWeight: "800",
  },
  historyRangeFooter: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  historyRangeDatesRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  historyRangeDateBlock: {
    minWidth: 0,
    flex: 1,
  },
  historyRangeDateLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  historyRangeDateValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
  },
  historyRangeDivider: {
    width: 1,
  },
  historyRangeApplyButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  historyRangeApplyText: {
    fontSize: 13,
    fontWeight: "800",
  },
  historyQuickFilterPanel: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  historyQuickFilterText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  totalPanel: {
    minHeight: 68,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  totalLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  totalHint: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  totalAmount: {
    flexShrink: 0,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  candidateWrap: {
    gap: 8,
  },
  candidateRow: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  candidateTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  smallMuted: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  errorBanner: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  errorAction: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  footerLoader: {
    paddingVertical: 18,
  },
  centeredModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  centeredKeyboardWrap: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "86%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    gap: 16,
  },
  modalHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  modalScrollContent: {
    gap: 16,
    paddingBottom: 2,
  },
  modalTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  modalCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePanel: {
    minHeight: 104,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  imageMessage: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  imageActions: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  imageActionButton: {
    minHeight: 36,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  imageActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  switchRow: {
    minHeight: 62,
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  switchIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  switchTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  switchSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
});
