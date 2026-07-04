import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchRetailerBalance, fetchRetailerBranchAllocations } from "@/api/retailers";
import { toApiError } from "@/api/client";
import type { AdminRetailerDetailScreenProps } from "@/navigation/types";
import type { RetailerBalanceRead } from "@/types/api";
import { formatCurrency, formatDateTime } from "@/utils/format";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { EmptyStateCard } from "./components/admin-dashboard-primitives";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

export function AdminRetailerDetailScreen({ navigation, route }: AdminRetailerDetailScreenProps) {
  const retailer = route.params.retailer;
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<RetailerBalanceRead | null>(null);
  const [allocatedShopCount, setAllocatedShopCount] = useState(retailer.allocated_shop_count ?? 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balanceData, branchRows] = await Promise.all([
        fetchRetailerBalance(retailer.id),
        fetchRetailerBranchAllocations(retailer.id),
      ]);
      setBalance(balanceData);
      setAllocatedShopCount(branchRows.filter((row) => row.is_allocated).length);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [retailer.id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["left", "right"]}>
      <StatusBar style="light" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          backgroundColor: palette.shell,
          borderBottomColor: palette.shellBorder,
          paddingTop: Math.max(insets.top - 8, 0),
        }}
      >
        <Pressable onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "900", color: palette.onShell }}>
          {retailer.name}
        </Text>
        <AdminHeaderActions onRefresh={() => load()} refreshing={loading} />
      </View>
      {loading ? (
        <ActivityIndicator color={palette.primary} style={{ marginTop: 24 }} />
      ) : error ? (
        <EmptyStateCard
          title="Unable to load retailer"
          subtitle={error}
          actionLabel="Retry"
          onAction={() => void load()}
          palette={palette}
          icon="alert-circle-outline"
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 16,
            }}
          >
            <Text style={{ color: palette.textMuted, fontSize: 12, fontWeight: "600" }}>
              OUTSTANDING BALANCE
            </Text>
            <Text style={{ color: palette.textPrimary, fontSize: 28, fontWeight: "800", marginTop: 6 }}>
              {formatCurrency(balance?.outstanding_balance ?? "0")}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              triggerHaptic();
              navigation.navigate("AdminRetailerBranches", {
                retailerId: retailer.id,
                retailerName: retailer.name,
              });
            }}
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 14,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Assign branches</Text>
            <Text style={{ color: palette.textMuted, marginTop: 4, fontSize: 13 }}>
              {allocatedShopCount
                ? `${allocatedShopCount} branch${allocatedShopCount === 1 ? "" : "es"} assigned`
                : "No branches assigned yet"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              triggerHaptic();
              navigation.navigate("AdminRetailers", {
                tab: "allocateItems",
                retailerId: retailer.id,
              });
            }}
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 14,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Allocate items</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              triggerHaptic();
              navigation.navigate("AdminRetailerEditor", { initialRetailer: retailer });
            }}
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 14,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Edit retailer</Text>
          </Pressable>
          <Text style={{ color: palette.textPrimary, fontWeight: "700", marginTop: 8 }}>Open sales</Text>
          {(balance?.open_sales ?? []).length === 0 ? (
            <Text style={{ color: palette.textMuted }}>No open or partial sales.</Text>
          ) : (
            balance?.open_sales.map((sale) => (
              <Pressable
                key={sale.id}
                onPress={() => {
                  triggerHaptic();
                  navigation.navigate("AdminRetailerSaleDetail", { saleId: sale.id });
                }}
                style={{
                  borderRadius: adminRadii.card,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.card,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>{sale.sale_no}</Text>
                <Text style={{ color: palette.textMuted, marginTop: 4 }}>
                  {sale.shop_name} · {formatDateTime(sale.created_at)}
                </Text>
                <Text
                  style={{
                    alignSelf: "flex-start",
                    marginTop: 6,
                    color: palette.textMuted,
                    fontSize: 11,
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >
                  {sale.status}
                </Text>
                <Text style={{ color: palette.warning, marginTop: 6, fontWeight: "700" }}>
                  Balance {formatCurrency(sale.balance_due)}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
