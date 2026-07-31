import { Decimal } from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function money(value?: string | number | null) {
  try {
    return new Decimal(value ?? 0);
  } catch {
    return new Decimal(0);
  }
}

export function toMoneyString(value?: string | number | null) {
  return money(value).toFixed(2);
}

export function toQuantityString(value?: string | number | null, isUnit = false) {
  const decimal = money(value);
  return isUnit ? decimal.toFixed(0) : decimal.toFixed(3);
}

/** Derive billed quantity from entered amount and unit price. */
export function quantityFromAmount(
  amount: string | number,
  pricePerUnit: string | number,
  isUnit: boolean,
) {
  const price = money(pricePerUnit);
  if (price.lessThanOrEqualTo(0)) {
    return isUnit ? "0" : "0.000";
  }
  const raw = money(amount).div(price);
  return isUnit ? raw.toFixed(0) : raw.toFixed(3);
}

/** Display weight with 2 decimals in amount mode; units stay integers. */
export function formatDisplayQuantity(
  quantity: string | number,
  isUnit: boolean,
  billingEntryMode: "kg" | "amount" = "kg",
) {
  if (isUnit) {
    return money(quantity).toFixed(0);
  }
  if (billingEntryMode === "amount") {
    return money(quantity).toFixed(2);
  }
  return toQuantityString(quantity, false);
}

export function sumMoney(values: (string | number | null | undefined)[]) {
  return values.reduce((total, value) => total.plus(money(value)), new Decimal(0));
}

function parseStrictDecimal(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  try {
    return new Decimal(trimmed);
  } catch {
    return null;
  }
}

export function isPositiveNumber(value: string) {
  return parseStrictDecimal(value)?.greaterThan(0) ?? false;
}

export function isNonNegativeNumber(value: string) {
  return parseStrictDecimal(value)?.greaterThanOrEqualTo(0) ?? false;
}
