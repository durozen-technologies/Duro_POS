import { money } from "@/utils/decimal";

export function resolveWalletCreditAmount(
  applyWalletCredit: boolean,
  walletBalance: string | null,
  amountDue: string,
  cashAmount: string,
  upiAmount: string,
): string {
  if (!applyWalletCredit || walletBalance === null) {
    return "0.00";
  }
  const remaining = money(amountDue).minus(money(cashAmount)).minus(money(upiAmount));
  if (remaining.lessThanOrEqualTo(0)) {
    return "0.00";
  }
  const available = money(walletBalance);
  return remaining.lessThanOrEqualTo(available) ? remaining.toFixed(2) : available.toFixed(2);
}

const WALLET_SELF_CHECK = process.env.RETAILER_WALLET_SELF_CHECK === "1";

if (WALLET_SELF_CHECK) {
  console.assert(
    resolveWalletCreditAmount(true, "500.00", "100.00", "0", "0") === "100.00",
    "wallet capped by bill",
  );
  console.assert(
    resolveWalletCreditAmount(true, "50.00", "100.00", "0", "0") === "50.00",
    "wallet capped by credit",
  );
  console.assert(
    resolveWalletCreditAmount(true, "500.00", "100.00", "60.00", "0") === "40.00",
    "wallet fills remainder after cash",
  );
  console.assert(
    resolveWalletCreditAmount(false, "500.00", "100.00", "0", "0") === "0.00",
    "unchecked wallet",
  );
  console.assert(
    resolveWalletCreditAmount(true, null, "100.00", "0", "0") === "0.00",
    "no wallet balance",
  );
}
