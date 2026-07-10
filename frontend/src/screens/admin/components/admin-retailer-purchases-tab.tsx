import { ActivityIndicator, Text, View } from "react-native";

import type { RetailerInventoryPurchaseRead } from "@/types/api";
import { formatCurrency, formatDateTime } from "@/utils/format";

import type { ThemePalette } from "../admin-dashboard-theme";
import { EmptyStateCard } from "./admin-dashboard-primitives";

type AdminRetailerPurchasesTabProps = {
  purchases: RetailerInventoryPurchaseRead[];
  loading: boolean;
  error: string | null;
  palette: ThemePalette;
  onRetry: () => void;
};

export function AdminRetailerPurchasesTab({
  purchases,
  loading,
  error,
  palette,
  onRetry,
}: AdminRetailerPurchasesTabProps) {
  if (loading) {
    return <ActivityIndicator color={palette.textPrimary} style={{ marginTop: 24 }} />;
  }
  if (error) {
    return (
      <EmptyStateCard
        title="Unable to load purchases"
        subtitle={error}
        actionLabel="Retry"
        onAction={onRetry}
        palette={palette}
        icon="alert-circle-outline"
      />
    );
  }
  if (purchases.length === 0) {
    return (
      <EmptyStateCard
        title="No inventory purchases"
        subtitle="Purchases recorded at any branch appear here."
        palette={palette}
        icon="cart-outline"
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {purchases.map((purchase) => (
        <View
          key={purchase.id}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.card,
            padding: 14,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: palette.textPrimary, fontWeight: "800", flex: 1 }}>
              {purchase.shop_name ?? "Branch"}
            </Text>
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              {formatDateTime(purchase.created_at)}
            </Text>
          </View>
          <Text style={{ color: palette.textPrimary, fontSize: 18, fontWeight: "800" }}>
            {formatCurrency(purchase.total_amount)}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 13 }}>
            Applied to debt {formatCurrency(purchase.amount_applied_to_outstanding)}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 13 }}>
            Deposited to wallet {formatCurrency(purchase.amount_deposited_to_wallet)}
          </Text>
          {(purchase.lines ?? []).map((line) => (
            <View
              key={line.id}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 12,
                paddingTop: 4,
              }}
            >
              <Text style={{ color: palette.textPrimary, flex: 1, fontWeight: "600" }}>
                {line.item_name}
              </Text>
              <Text style={{ color: palette.textMuted, fontWeight: "700" }}>
                {line.quantity} × {formatCurrency(line.price_per_unit)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
