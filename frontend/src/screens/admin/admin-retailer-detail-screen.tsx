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

import { fetchAdminRetailerInventoryPurchases } from "@/api/retailer-inventory";
import { fetchRetailerBalance, fetchRetailerBranchAllocations } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import type { AdminRetailerDetailScreenProps } from "@/navigation/types";
import type { RetailerBalanceRead, RetailerInventoryPurchaseRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";
import { canShareRetailerStatement } from "@/utils/retailer-statement";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { EmptyStateCard } from "./components/admin-dashboard-primitives";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { AdminRetailerBillsTab } from "./components/admin-retailer-bills-tab";
import { AdminRetailerOutstandingBalanceModal } from "./components/admin-retailer-outstanding-balance-modal";
import { AdminRetailerPurchasesTab } from "./components/admin-retailer-purchases-tab";
import { AdminRetailerStatementModal } from "./components/admin-retailer-statement-modal";
import { AdminRetailerWalletPayoutModal } from "./components/admin-retailer-wallet-payout-modal";
import { useAdminTheme } from "./use-admin-theme";

type DetailTab = "overview" | "bills" | "purchases";

export function AdminRetailerDetailScreen({ navigation, route }: AdminRetailerDetailScreenProps) {
  const retailer = route.params.retailer;
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [balance, setBalance] = useState<RetailerBalanceRead | null>(null);
  const [purchases, setPurchases] = useState<RetailerInventoryPurchaseRead[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);
  const [allocatedShopCount, setAllocatedShopCount] = useState(retailer.allocated_shop_count ?? 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [walletPayoutModalOpen, setWalletPayoutModalOpen] = useState(false);
  const [outstandingBalanceModalOpen, setOutstandingBalanceModalOpen] = useState(false);
  const canShareStatement = canShareRetailerStatement(balance?.open_sales ?? []);
  const canPayOutWallet = money(balance?.credit_balance ?? 0).gt(0);

  const loadOverview = useCallback(async () => {
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
      setError(formatApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [retailer.id]);

  const loadPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    try {
      const page = await fetchAdminRetailerInventoryPurchases(retailer.id, { limit: 50 });
      setPurchases(page.items ?? []);
      setPurchasesError(null);
    } catch (err) {
      setPurchasesError(formatApiErrorMessage(err));
    } finally {
      setPurchasesLoading(false);
    }
  }, [retailer.id]);

  const load = useCallback(async () => {
    setRefreshNonce((value) => value + 1);
    await Promise.all([loadOverview(), loadPurchases()]);
  }, [loadOverview, loadPurchases]);

  useFocusEffect(useCallback(() => { void loadOverview(); void loadPurchases(); }, [loadOverview, loadPurchases]));

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
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 20, fontWeight: "900", color: palette.onShell }} numberOfLines={1}>
            {retailer.name}
          </Text>
          {retailer.shop_name ? (
            <Text style={{ color: palette.onShellMuted, marginTop: 2, fontSize: 13 }} numberOfLines={1}>
              {retailer.shop_name}
            </Text>
          ) : null}
        </View>
        <AdminHeaderActions onRefresh={() => load()} refreshing={loading || purchasesLoading} />
      </View>
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          backgroundColor: palette.background,
        }}
      >
        {(["overview", "bills", "purchases"] as const).map((tab) => {
          const selected = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => {
                triggerHaptic();
                setActiveTab(tab);
              }}
              style={{
                flex: 1,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected ? palette.primary : palette.border,
                backgroundColor: selected ? palette.card : palette.background,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: selected ? palette.primary : palette.textMuted,
                  fontWeight: "800",
                  fontSize: 12,
                }}
              >
                {tab === "overview" ? "Overview" : tab === "bills" ? "Bills" : "Purchases"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {activeTab === "bills" ? (
        <View style={{ flex: 1, padding: 16 }}>
          <AdminRetailerBillsTab
            retailerId={retailer.id}
            palette={palette}
            refreshNonce={refreshNonce}
            onOpenSale={(saleId) => navigation.navigate("AdminRetailerSaleDetail", { saleId })}
          />
        </View>
      ) : activeTab === "purchases" ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <AdminRetailerPurchasesTab
            purchases={purchases}
            loading={purchasesLoading}
            error={purchasesError}
            palette={palette}
            onRetry={() => void loadPurchases()}
          />
        </ScrollView>
      ) : loading ? (
        <ActivityIndicator color={palette.primary} style={{ marginTop: 24 }} />
      ) : error ? (
        <EmptyStateCard
          title="Unable to load retailer"
          subtitle={error}
          actionLabel="Retry"
          onAction={() => void loadOverview()}
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Text style={{ color: palette.textPrimary, fontSize: 28, fontWeight: "800", flex: 1 }}>
                {formatCurrency(balance?.outstanding_balance ?? "0")}
              </Text>
              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setOutstandingBalanceModalOpen(true);
                }}
                hitSlop={8}
                style={{
                  borderRadius: adminRadii.control,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.surfaceMuted,
                  padding: 8,
                }}
              >
                <MaterialCommunityIcons name="pencil-outline" size={18} color={palette.primary} />
              </Pressable>
            </View>
            <Text style={{ color: palette.textMuted, fontSize: 12, fontWeight: "600", marginTop: 14 }}>
              WALLET CREDIT
            </Text>
            <Text style={{ color: palette.textPrimary, fontSize: 20, fontWeight: "800", marginTop: 6 }}>
              {formatCurrency(balance?.credit_balance ?? "0")}
            </Text>
            <Pressable
              onPress={() => {
                if (!canPayOutWallet) {
                  return;
                }
                triggerHaptic();
                setWalletPayoutModalOpen(true);
              }}
              disabled={!canPayOutWallet}
              style={{
                marginTop: 10,
                alignSelf: "flex-start",
                borderRadius: adminRadii.control,
                backgroundColor: palette.success,
                paddingVertical: 6,
                paddingHorizontal: 12,
                opacity: canPayOutWallet ? 1 : 0.55,
              }}
            >
              <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>Pay out credit</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={() => {
                triggerHaptic();
                navigation.navigate("AdminRetailerBranches", {
                  retailerId: retailer.id,
                  retailerName: retailer.name,
                });
              }}
              style={{
                flex: 1,
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
                  ? `${allocatedShopCount} branch${allocatedShopCount === 1 ? "" : "es"}`
                  : "None assigned"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                triggerHaptic();
                navigation.navigate("AdminRetailerEditor", { initialRetailer: retailer });
              }}
              style={{
                flex: 1,
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 14,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Edit retailer</Text>
              <Text style={{ color: palette.textMuted, marginTop: 4, fontSize: 13 }}>
                Update details
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={() => {
                if (!canShareStatement) {
                  return;
                }
                triggerHaptic();
                setStatementModalOpen(true);
              }}
              disabled={!canShareStatement}
              style={{
                flex: 1,
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 14,
                opacity: canShareStatement ? 1 : 0.55,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Share Statement</Text>
              <Text style={{ color: palette.textMuted, marginTop: 4, fontSize: 13 }}>
                {canShareStatement
                  ? "PDF statement with outstanding bills only"
                  : "No outstanding bills to share"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                triggerHaptic();
                setActiveTab("bills");
              }}
              style={{
                flex: 1,
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 14,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>View bills</Text>
              <Text style={{ color: palette.textMuted, marginTop: 4, fontSize: 13 }}>
                Pending and fully paid retailer bills
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
      <AdminRetailerStatementModal
        visible={statementModalOpen}
        retailer={retailer}
        palette={palette}
        onClose={() => setStatementModalOpen(false)}
      />
      <AdminRetailerWalletPayoutModal
        visible={walletPayoutModalOpen}
        retailer={retailer}
        creditBalance={balance?.credit_balance ?? "0"}
        palette={palette}
        onClose={() => setWalletPayoutModalOpen(false)}
        onSaved={(creditBalanceAfter) => {
          setBalance((current) =>
            current
              ? { ...current, credit_balance: creditBalanceAfter }
              : current,
          );
        }}
      />
      <AdminRetailerOutstandingBalanceModal
        visible={outstandingBalanceModalOpen}
        retailer={retailer}
        outstandingBalance={balance?.outstanding_balance ?? "0"}
        palette={palette}
        onClose={() => setOutstandingBalanceModalOpen(false)}
        onSaved={(updatedBalance) => {
          setBalance((current) =>
            current
              ? {
                  ...current,
                  outstanding_balance: updatedBalance.outstanding_balance,
                  opening_balance: updatedBalance.opening_balance ?? current.opening_balance,
                }
              : current,
          );
        }}
      />
    </SafeAreaView>
  );
}
