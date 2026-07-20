import { money } from "@/utils/decimal";

export function computeSettleableOutstanding(openingBalance: string, billsOutstanding: string) {
  return money(openingBalance).plus(money(billsOutstanding)).toFixed(2);
}

export function sumPendingBillsBalance(balanceDues: readonly string[]) {
  return balanceDues
    .reduce((total, value) => total.plus(money(value)), money(0))
    .toFixed(2);
}
