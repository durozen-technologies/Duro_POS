import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import type { AdminRetailersScreenProps } from "@/navigation/types";
import type { RetailerRead } from "@/types/api";

import { adminSpacing, adminTypography } from "./admin-dashboard-theme";
import type { AdminRetailersTab } from "./admin-dashboard-utils";
import { AdminSegmentedTabs } from "./components/admin-design-system";
import { AdminRetailersAllocateItemsTab } from "./components/admin-retailers-allocate-items-tab";
import { AdminRetailersDirectoryTab } from "./components/admin-retailers-directory-tab";
import { AdminRetailersSalesTab } from "./components/admin-retailers-sales-tab";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

const TAB_ITEMS: { value: AdminRetailersTab; label: string; icon: "account-group-outline" | "playlist-plus" | "receipt-text-outline" }[] = [
  { value: "retailers", label: "Retailers", icon: "account-group-outline" },
  { value: "allocateItems", label: "Allocate items", icon: "playlist-plus" },
  { value: "sales", label: "Open sales", icon: "receipt-text-outline" },
];

export function AdminRetailersScreen({ navigation, route }: AdminRetailersScreenProps) {
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const initialTab = route.params?.tab ?? "retailers";
  const initialRetailerId = route.params?.retailerId ?? null;
  const [activeTab, setActiveTab] = useState<AdminRetailersTab>(initialTab);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleHeaderRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshNonce((value) => value + 1);
  }, []);

  const handleRefreshComplete = useCallback(() => {
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (route.params?.tab) {
      setActiveTab(route.params.tab);
    }
  }, [route.params?.tab]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: palette.background },
        topBar: {
          flexDirection: "row",
          alignItems: "center",
          gap: adminSpacing.sm,
          paddingHorizontal: adminSpacing.md,
          paddingBottom: adminSpacing.sm,
          borderBottomWidth: 1,
          backgroundColor: palette.shell,
          borderBottomColor: palette.shellBorder,
          paddingTop: Math.max(insets.top - 8, 0),
        },
      }),
    [insets.top, palette],
  );

  const handleOpenRetailer = useCallback(
    (retailer: RetailerRead) => navigation.navigate("AdminRetailerDetail", { retailer }),
    [navigation],
  );

  const handleCreateRetailer = useCallback(
    () => navigation.navigate("AdminRetailerEditor"),
    [navigation],
  );

  const handleOpenSale = useCallback(
    (saleId: string) => navigation.navigate("AdminRetailerSaleDetail", { saleId }),
    [navigation],
  );

  return (
    <SafeAreaView style={dynamicStyles.screen} edges={["left", "right"]}>
      <StatusBar style="light" />

      <View style={dynamicStyles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <Text style={[styles.title, { color: palette.onShell }]} numberOfLines={1}>
          Retailers
        </Text>
        <AdminHeaderActions onRefresh={handleHeaderRefresh} refreshing={refreshing} />
      </View>

      <View style={styles.content}>
        <AdminSegmentedTabs
          items={TAB_ITEMS}
          activeValue={activeTab}
          palette={palette}
          onChange={(value) => setActiveTab(value as AdminRetailersTab)}
        />

        <View style={styles.tabBody}>
          {activeTab === "retailers" ? (
            <AdminRetailersDirectoryTab
              palette={palette}
              refreshNonce={refreshNonce}
              onRefreshComplete={handleRefreshComplete}
              onOpenRetailer={handleOpenRetailer}
              onCreateRetailer={handleCreateRetailer}
            />
          ) : null}

          {activeTab === "allocateItems" ? (
            <AdminRetailersAllocateItemsTab
              palette={palette}
              refreshNonce={refreshNonce}
              onRefreshComplete={handleRefreshComplete}
              initialRetailerId={initialRetailerId}
            />
          ) : null}

          {activeTab === "sales" ? (
            <AdminRetailersSalesTab
              palette={palette}
              refreshNonce={refreshNonce}
              onRefreshComplete={handleRefreshComplete}
              onOpenSale={handleOpenSale}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: {
    flex: 1,
    ...adminTypography.pageTitle,
  },
  content: {
    flex: 1,
    paddingHorizontal: adminSpacing.md,
    paddingTop: adminSpacing.sm,
    gap: adminSpacing.sm,
  },
  tabBody: {
    flex: 1,
  },
});
