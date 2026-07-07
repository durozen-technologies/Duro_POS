import * as Haptics from "expo-haptics";

import { AnalyticsPeriod, BaseUnit, type ShopRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { APP_TIME_ZONE, addCalendarDays, createDateTimeFormat, formatDate, parseCalendarDate, todayDateValue } from "@/utils/format";

export type AdminNavTab = "dashboard" | "billing" | "items" | "sales" | "inventory" | "expenses" | "retailers" | "settings";

export type AdminRetailersTab = "retailers" | "allocateItems" | "retailerPrices" | "sales";
export type SectionKey = AdminNavTab;
export type AnalyticsSectionKey = "sales" | "billing" | "settings";
export type LogSeverity = "info" | "warning" | "error" | "critical";
export type ShopOperationalState = "ACTIVE" | "IDLE" | "OFFLINE" | "DISABLED";
export type ToastTone = "success" | "error";

export type SeverityMeta = {
  tone: ToastTone | "warning" | "neutral";
  label: LogSeverity;
  icon: string;
  chipBackground: string;
  chipText: string;
};

export const NAV_ITEMS: { key: AdminNavTab; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "view-dashboard-outline" },
  { key: "sales", label: "Sales", icon: "chart-line" },
  { key: "items", label: "Items", icon: "playlist-edit" },
  { key: "inventory", label: "Inventory", icon: "warehouse" },
  { key: "expenses", label: "Expenses", icon: "cash-minus" },
  { key: "retailers", label: "Retailers", icon: "store-outline" },
  { key: "settings", label: "Settings", icon: "cog-outline" },
];

// ponytail: Hermes on Android does not support Intl.NumberFormat { notation: "compact" } —
// it throws "Cannot convert undefined value to object" at module init. Use manual compact logic.
function compactNumber(value: number, precision: number): string {
  if (Math.abs(value) >= 10_000_000) return `${(value / 10_000_000).toFixed(precision)}Cr`;
  if (Math.abs(value) >= 100_000) return `${(value / 100_000).toFixed(precision)}L`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(precision)}K`;
  return `${value.toFixed(0)}`;
}

const optionDayFormatter = createDateTimeFormat({
  weekday: "short",
  day: "numeric",
  month: "short",
});

const monthYearFormatter = createDateTimeFormat({
  month: "long",
  year: "numeric",
});

const shortWeekFormatter = createDateTimeFormat({
  day: "numeric",
  month: "short",
});

const weekRangeEndFormatter = createDateTimeFormat({
  day: "numeric",
  month: "short",
  year: "numeric",
});

const fullAnalyticsDateFormatter = createDateTimeFormat({
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const analyticsYearFormatter = createDateTimeFormat({
  year: "numeric",
});

export function triggerHaptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  void Haptics.impactAsync(style).catch(() => undefined);
}

export function formatCompactCurrency(value: string | number) {
  const numericValue = Number(money(value).toFixed(2));
  const precision = Math.abs(numericValue) >= 100_000 ? 1 : 0;
  return `Rs. ${compactNumber(numericValue, precision)}`;
}

export function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "Never logged in";
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export function getShopStatus(shop: ShopRead, lastActivityAt?: string | null): ShopOperationalState {
  if (!shop.is_active) {
    return "DISABLED";
  }

  if (!lastActivityAt) {
    return "OFFLINE";
  }

  const diffHours = (Date.now() - new Date(lastActivityAt).getTime()) / 3600000;
  if (diffHours <= 1) {
    return "ACTIVE";
  }

  if (diffHours <= 6) {
    return "IDLE";
  }

  return "OFFLINE";
}



function istWeekdayMondayZero(dateValue: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
  }).format(parseCalendarDate(dateValue));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (days.indexOf(weekday) + 6) % 7;
}

function getStartOfWeek(dateValue: string) {
  return addCalendarDays(dateValue, -istWeekdayMondayZero(dateValue));
}

function parseLocalDateValue(value: string) {
  return parseCalendarDate(value);
}

export function buildDateOptions() {
  const today = todayDateValue();
  return Array.from({ length: 14 }, (_, index) => {
    const value = addCalendarDays(today, -index);
    const date = parseCalendarDate(value);

    return {
      value,
      label:
        index === 0
          ? "Today"
          : index === 1
            ? "Yesterday"
            : optionDayFormatter.format(date),
    };
  });
}

export function buildMonthOptions() {
  const [yearText, monthText] = todayDateValue().split("-");
  let year = Number(yearText);
  let month = Number(monthText);
  return Array.from({ length: 12 }, (_, index) => {
    let targetMonth = month - index;
    let targetYear = year;
    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }
    const value = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
    return {
      value,
      label: monthYearFormatter.format(parseCalendarDate(value)),
    };
  });
}

export function buildWeekOptions() {
  const currentWeekStart = getStartOfWeek(todayDateValue());
  return Array.from({ length: 12 }, (_, index) => {
    const value = addCalendarDays(currentWeekStart, -index * 7);
    const weekEnd = addCalendarDays(value, 6);

    return {
      value,
      label:
        index === 0
          ? "This Week"
          : index === 1
            ? "Last Week"
            : `${shortWeekFormatter.format(parseCalendarDate(value))} - ${weekRangeEndFormatter.format(parseCalendarDate(weekEnd))}`,
    };
  });
}

export function buildYearOptions() {
  const currentYear = Number(todayDateValue().slice(0, 4));
  return Array.from({ length: 6 }, (_, index) => {
    const year = currentYear - index;
    return {
      value: `${year}-01-01`,
      label: `${year}`,
    };
  });
}

export function formatAnalyticsReference(
  period: AnalyticsPeriod,
  value: string,
  range?: { startDate?: string | null; endDate?: string | null },
) {
  if (period === AnalyticsPeriod.RANGE && range?.startDate && range.endDate) {
    const startDate = parseLocalDateValue(range.startDate);
    const endDate = parseLocalDateValue(range.endDate);
    if (range.startDate === range.endDate) {
      return fullAnalyticsDateFormatter.format(startDate);
    }
    return `${shortWeekFormatter.format(startDate)} - ${weekRangeEndFormatter.format(endDate)}`;
  }

  const date = parseLocalDateValue(value);

  if (period === AnalyticsPeriod.DATE) {
    return fullAnalyticsDateFormatter.format(date);
  }

  if (period === AnalyticsPeriod.MONTH) {
    return monthYearFormatter.format(date);
  }

  if (period === AnalyticsPeriod.YEAR) {
    return analyticsYearFormatter.format(date);
  }

  const weekStart = getStartOfWeek(value);
  const weekEnd = addCalendarDays(weekStart, 6);
  return `${shortWeekFormatter.format(parseCalendarDate(weekStart))} - ${weekRangeEndFormatter.format(parseCalendarDate(weekEnd))}`;
}

export function getUnitLabel(unit: BaseUnit, quantity: string) {
  const numericQuantity = money(quantity).toNumber();
  const normalizedQuantity = Number.isInteger(numericQuantity) ? `${numericQuantity}` : `${numericQuantity.toFixed(2)}`;
  return `${normalizedQuantity} ${unit === BaseUnit.KG ? "Kg" : numericQuantity === 1 ? "Unit" : "Units"}`;
}

export function groupBillsByDate<T extends { created_at: string }>(items: T[]) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = formatDate(item.created_at);
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([label, entries]) => ({
    label,
    entries,
  }));
}
