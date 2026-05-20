import * as Haptics from "expo-haptics";

import type { AnalyticsPeriod, BaseUnit, ShopRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatDate } from "@/utils/format";

export type AdminNavTab = "dashboard" | "billing" | "inventory" | "settings";
export type SectionKey = AdminNavTab;
export type AnalyticsSectionKey = "inventory" | "billing" | "settings";
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
  { key: "inventory", label: "Inventory", icon: "food-drumstick-outline" },
  { key: "billing", label: "Billing", icon: "receipt-text-outline" },
  { key: "settings", label: "Settings", icon: "cog-outline" },
];

const compactCurrencyFormatter = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 0,
});

const compactCurrencyPrecisionFormatter = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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
  const compact = (
    numericValue >= 100000 ? compactCurrencyPrecisionFormatter : compactCurrencyFormatter
  ).format(numericValue);

  return `Rs. ${compact}`;
}

export function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "No recent sync";
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

export function formatAnalyticsReference(period: AnalyticsPeriod, value: string) {
  const date = parseLocalDateValue(value);

  if (period === "date") {
    return fullAnalyticsDateFormatter.format(date);
  }

  if (period === "month") {
    return monthYearFormatter.format(date);
  }

  if (period === "year") {
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
  return `${normalizedQuantity} ${unit === "kg" ? "Kg" : numericQuantity === 1 ? "Unit" : "Units"}`;
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
