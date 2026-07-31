import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchAllRetailers, updateAdminRetailersOrder } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import type { AdminRetailersOrderScreenProps } from "@/navigation/types";
import type { RetailerRead } from "@/types/api";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

function OrderRow({ item, drag, isActive }: RenderItemParams<RetailerRead>) {
  const { palette } = useAdminTheme();
  const statusLabel = item.is_active ? "Active" : "Paused";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Arrange ${item.name}`}
      onLongPress={() => {
        triggerHaptic();
        drag();
      }}
      delayLongPress={120}
      disabled={isActive}
      style={[
        styles.orderRow,
        {
          borderColor: isActive ? palette.primary : palette.border,
          backgroundColor: isActive ? palette.primarySoft : palette.card,
        },
      ]}
    >
      <View style={[styles.dragIconWrap, { backgroundColor: palette.surfaceMuted }]}>
        <MaterialCommunityIcons name="store-outline" size={20} color={palette.textPrimary} />
      </View>
      <View style={styles.orderText}>
        <Text numberOfLines={1} style={[styles.orderName, { color: palette.textPrimary }]}>
          {item.name}
        </Text>
        {item.shop_name ? (
          <Text numberOfLines={1} style={[styles.orderMeta, { color: palette.textSecondary }]}>
            {item.shop_name}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={[styles.orderMeta, { color: palette.textMuted }]}>
          {statusLabel}
          {item.phone ? ` · ${item.phone}` : ""}
        </Text>
      </View>
      <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={palette.textMuted} />
    </Pressable>
  );
}

function OrderLoadingState({ palette }: { palette: ThemePalette }) {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={palette.primary} />
      <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading retailers…</Text>
    </View>
  );
}

function OrderEmptyState({ palette }: { palette: ThemePalette }) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <MaterialCommunityIcons name="store-outline" size={28} color={palette.textMuted} />
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>No retailers</Text>
      <Text style={[styles.emptyText, { color: palette.textMuted }]}>
        Add retailers before arranging display order.
      </Text>
    </View>
  );
}

export function AdminRetailersOrderScreen({ navigation }: AdminRetailersOrderScreenProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme, palette } = useAdminTheme();
  const [items, setItems] = useState<RetailerRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const subtitle = useMemo(
    () => `${items.length} retailers · long-press to drag`,
    [items.length],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await fetchAllRetailers();
      setItems(loaded);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, "Unable to load retailers."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const persistOrder = useCallback(
    async (nextItems: RetailerRead[]) => {
      if (nextItems.length === 0) {
        return;
      }
      setSaving(true);
      setErrorMessage(null);
      try {
        await updateAdminRetailersOrder({
          retailer_ids: nextItems.map((item) => item.id),
        });
      } catch (error) {
        triggerHaptic();
        setErrorMessage(formatApiErrorMessage(error, "Unable to save retailer order."));
        await loadItems();
      } finally {
        setSaving(false);
      }
    },
    [loadItems],
  );

  const renderItem = useCallback(
    (params: RenderItemParams<RetailerRead>) => <OrderRow {...params} />,
    [],
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={colorScheme === "dark" ? "light" : "light"} />
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: palette.shell,
            borderBottomColor: palette.shellBorder,
            paddingTop: Math.max(insets.top - 8, 0),
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            Rearrange retailers
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {saving ? "Saving…" : subtitle}
          </Text>
        </View>
        <AdminHeaderActions
          refreshing={loading}
          refreshDisabled={saving}
          onRefresh={loadItems}
        />
      </View>

      {errorMessage ? (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: palette.dangerSoft, borderColor: palette.danger },
          ]}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <OrderLoadingState palette={palette} />
      ) : (
        <DraggableFlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={({ data }) => {
            setItems(data);
            void persistOrder(data);
          }}
          activationDistance={8}
          containerStyle={{ flex: 1, backgroundColor: palette.background }}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 42 + insets.bottom,
            gap: 8,
          }}
          ListEmptyComponent={<OrderEmptyState palette={palette} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: "900" },
  subtitle: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  loadingText: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  emptyState: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 16, lineHeight: 21, fontWeight: "900", textAlign: "center" },
  emptyText: {
    maxWidth: 320,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBanner: {
    margin: 14,
    marginBottom: 0,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  orderRow: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dragIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { flex: 1, minWidth: 0 },
  orderName: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  orderMeta: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
});
