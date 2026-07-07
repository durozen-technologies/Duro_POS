import { BaseUnit } from "@/types/api";
import { money } from "@/utils/decimal";

export const APP_TIME_ZONE = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: APP_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: APP_TIME_ZONE,
});

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function createDateTimeFormat(
  options: Intl.DateTimeFormatOptions,
  locales: string | string[] = "en-IN",
) {
  return new Intl.DateTimeFormat(locales, { ...options, timeZone: APP_TIME_ZONE });
}

/** Calendar date YYYY-MM-DD in app timezone (IST). */
export function formatDateValueInTimeZone(
  instant: Date,
  timeZone: string = APP_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function todayDateValue(): string {
  return formatDateValueInTimeZone(new Date());
}

/** Parse YYYY-MM-DD as IST calendar date for display formatters. */
export function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00+05:30`);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateValueInTimeZone(date);
}

export function formatCurrency(value?: string | number | null) {
  return `Rs. ${currencyFormatter.format(money(value).toNumber())}`;
}

export function formatUnit(unit: BaseUnit) {
  return unit === BaseUnit.KG ? "kg" : "unit";
}

export function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}
