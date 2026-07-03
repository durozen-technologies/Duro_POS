import * as Haptics from "expo-haptics";

import { AnalyticsPeriod, BaseUnit, type ShopRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatDate } from "@/utils/format";

export type AdminNavTab = "dashboard" | "billing" | "items" | "sales" | "inventory" | "expenses" | "retailers" | "settings";

export type AdminRetailersTab = "retailers" | "items" | "sales";
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

const optionDayFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const monthYearFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
});

const shortWeekFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});

const weekRangeEndFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const fullAnalyticsDateFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const analyticsYearFormatter = new Intl.DateTimeFormat("en-IN", {
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



function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartOfWeek(date: Date) {
  const weekStart = new Date(date);
  const dayOfWeek = weekStart.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + offset);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function parseLocalDateValue(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(value);
  }

  return new Date(year, month - 1, day);
}

export function buildDateOptions() {
  const today = new Date();
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const value = toLocalDateValue(date);

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
  const today = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    const value = toLocalDateValue(date);

    return {
      value,
      label: monthYearFormatter.format(date),
    };
  });
}

export function buildWeekOptions() {
  const currentWeekStart = getStartOfWeek(new Date());
  return Array.from({ length: 12 }, (_, index) => {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(currentWeekStart.getDate() - index * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    return {
      value: toLocalDateValue(weekStart),
      label:
        index === 0
          ? "This Week"
          : index === 1
            ? "Last Week"
            : `${shortWeekFormatter.format(weekStart)} - ${weekRangeEndFormatter.format(weekEnd)}`,
    };
  });
}

export function buildYearOptions() {
  const currentYear = new Date().getFullYear();
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

  const weekStart = getStartOfWeek(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `${shortWeekFormatter.format(weekStart)} - ${weekRangeEndFormatter.format(weekEnd)}`;
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
