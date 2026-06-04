import { BaseUnit } from "@/types/api";
import { money } from "@/utils/decimal";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
});

export function formatCurrency(value?: string | number | null) {
  return `Rs. ${money(value).toFixed(2)}`;
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
