import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XStack, YStack } from "tamagui";

import {
  createTransferShop,
  fetchInventoryTransfersPage,
  fetchTransferShops,
  updateTransferShop,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import { type InventoryTransferRead, type TransferShopRead } from "@/types/api";
import { formatDateTime } from "@/utils/format";
import { adminElevation } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import { ActionButton, EmptyStateCard, SearchField } from "./admin-dashboard-primitives";
import { AdminTextField } from "./admin-text-field";

function getRequestMessage(error: unknown, fallback: string) {
  return toApiError(error).message || fallback;
}

export function AdminTransferShopsTab() {
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  
  const [shops, setShops] = useState<TransferShopRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [draftName, setDraftName] = useState("");
  const [draftTamilName, setDraftTamilName] = useState("");
  const [saving, setSaving] = useState(false);
  
  const [editingShop, setEditingShop] = useState<TransferShopRead | null>(null);
  const [editName, setEditName] = useState("");
  const [editTamilName, setEditTamilName] = useState("");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  
  const [historyShop, setHistoryShop] = useState<TransferShopRead | null>(null);
  const [historyItems, setHistoryItems] = useState<InventoryTransferRead[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const data = await fetchTransferShops();
      setShops(data);
    } catch (error) {
      if (!isApiRequestCanceled(error)) {
        triggerHaptic();
        setErrorMessage(getRequestMessage(error, "Unable to load transfer shops."));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredShops = useMemo(() => {
    if (!searchQuery.trim()) return shops;
    const lower = searchQuery.trim().toLowerCase();
    return shops.filter((s) => s.name.toLowerCase().includes(lower) || s.tamil_name.toLowerCase().includes(lower));
  }, [shops, searchQuery]);

  const handleCreate = async () => {
    const name = draftName.trim();
    const tamil_name = draftTamilName.trim();
    if (!name || !tamil_name) return;

    setSaving(true);
    setErrorMessage(null);
    try {
      await createTransferShop({ name, tamil_name, is_active: true });
      setDraftName("");
      setDraftTamilName("");
      setCreateModalOpen(false);
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to create transfer shop."));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingShop) return;
    const name = editName.trim();
    const tamil_name = editTamilName.trim();
    if (!name || !tamil_name) return;

    setSaving(true);
    setErrorMessage(null);
    try {
      await updateTransferShop(editingShop.id, { name, tamil_name });
      setEditingShop(null);
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update transfer shop."));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (shop: TransferShopRead) => {
    setErrorMessage(null);
    try {
      await updateTransferShop(shop.id, { is_active: !shop.is_active });
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update shop status."));
    }
  };

  const loadHistory = async (shop: TransferShopRead) => {
    setHistoryShop(shop);
    setHistoryLoading(true);
    setHistoryItems([]);
    try {
      const data = await fetchInventoryTransfersPage({ transfer_shop_id: shop.id });
      setHistoryItems(data.items);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load transfer history."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const renderRow = ({ item }: { item: TransferShopRead }) => (
    <YStack 
      backgroundColor={palette.card} 
      borderColor={palette.border} 
      borderWidth={1} 
      borderRadius={16} 
      padding={16}
      gap={16}
    >
      <YStack gap={4}>
        <XStack alignItems="center" justifyContent="space-between">
          <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: item.is_active ? palette.inventorySoft : palette.surfaceMuted }]}>
            <Text style={[styles.badgeText, { color: item.is_active ? palette.inventory : palette.textMuted }]}>
              {item.is_active ? "Active" : "Inactive"}
            </Text>
          </View>
        </XStack>
        <Text style={[styles.rowSubtitle, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
      </YStack>
      
      <XStack 
        paddingTop={16} 
        borderTopWidth={1} 
        borderTopColor={palette.border} 
        gap={12} 
        flexWrap="wrap"
      >
        <ActionButton 
          label="Edit" 
          icon="pencil-outline" 
          palette={palette} 
          onPress={() => {
            setEditName(item.name);
            setEditTamilName(item.tamil_name);
            setEditingShop(item);
          }} 
        />
        <ActionButton 
          label={item.is_active ? "Deactivate" : "Activate"} 
          icon={item.is_active ? "cancel" : "check"} 
          palette={palette} 
          tone={item.is_active ? "neutral" : "success"}
          onPress={() => toggleActive(item)} 
        />
        <ActionButton 
          label="History" 
          icon="history" 
          palette={palette} 
          tone="info"
          active
          onPress={() => loadHistory(item)} 
        />
      </XStack>
    </YStack>
  );

  return (
    <View style={styles.container}>
      {errorMessage && (
        <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      )}

      {/* SEARCH AND ADD */}
      <XStack paddingHorizontal={16} paddingTop={16} paddingBottom={8} gap={12}>
        <YStack flex={1}>
          <SearchField 
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search transfer shops..."
            palette={palette}
          />
        </YStack>
        <ActionButton 
          label="Add shop" 
          icon="plus" 
          palette={palette} 
          tone="success" 
          active 
          onPress={() => setCreateModalOpen(true)} 
        />
      </XStack>

      {/* LIST */}
      <FlatList
        data={filteredShops}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={palette.inventory} />}
        ListEmptyComponent={
          !loading ? (
            <EmptyStateCard 
              title="No transfer shops found" 
              subtitle={searchQuery ? "Try a different search query." : "You haven't added any transfer shops yet."} 
              icon="storefront-outline" 
              palette={palette} 
              actionLabel={!searchQuery ? "Add a shop" : undefined}
              onAction={!searchQuery ? () => setCreateModalOpen(true) : undefined}
            />
          ) : null
        }
      />

      {/* CREATE MODAL */}
      <Modal visible={createModalOpen} transparent animationType="fade">
        <KeyboardAvoidingView 
          style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
        >
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>Add Transfer Shop</Text>
              <Pressable hitSlop={12} onPress={() => setCreateModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <YStack padding={20} gap={16}>
              <AdminTextField
                label="English Name"
                placeholder="Shop Name"
                value={draftName}
                onChangeText={setDraftName}
                palette={palette}
              />
              <AdminTextField
                label="Tamil Name"
                placeholder="Shop Tamil Name"
                value={draftTamilName}
                onChangeText={setDraftTamilName}
                palette={palette}
              />
              <XStack paddingTop={8}>
                <ActionButton 
                  label="Create Shop" 
                  icon="check" 
                  palette={palette} 
                  tone="success" 
                  active 
                  disabled={!draftName || !draftTamilName || saving}
                  loading={saving}
                  onPress={handleCreate} 
                />
              </XStack>
            </YStack>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT MODAL */}
      <Modal visible={!!editingShop} transparent animationType="fade">
        <KeyboardAvoidingView 
          style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
        >
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>Edit Shop</Text>
              <Pressable hitSlop={12} onPress={() => setEditingShop(null)}>
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <YStack padding={20} gap={16}>
              <AdminTextField
                label="English Name"
                value={editName}
                onChangeText={setEditName}
                palette={palette}
              />
              <AdminTextField
                label="Tamil Name"
                value={editTamilName}
                onChangeText={setEditTamilName}
                palette={palette}
              />
              <XStack paddingTop={8}>
                <ActionButton 
                  label="Save Changes" 
                  icon="content-save-outline" 
                  palette={palette} 
                  tone="success" 
                  active 
                  disabled={!editName || !editTamilName || saving}
                  loading={saving}
                  onPress={handleUpdate} 
                />
              </XStack>
            </YStack>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* HISTORY MODAL */}
      <Modal visible={!!historyShop} transparent animationType="slide">
        <View style={[styles.fullModalOverlay, { backgroundColor: palette.shell }]}>
          <View style={[styles.fullModalHeader, { borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top, 16) }]}>
            <Pressable hitSlop={12} onPress={() => setHistoryShop(null)}>
              <MaterialCommunityIcons name="close" size={24} color={palette.onShell} />
            </Pressable>
            <Text style={[styles.fullModalTitle, { color: palette.onShell }]}>{historyShop?.name} Transfers</Text>
            <View style={{ width: 24 }} />
          </View>
          {historyLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color={palette.inventory} />
          ) : (
            <FlatList
              data={historyItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
              ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
              ListEmptyComponent={
                <EmptyStateCard 
                  title="No transfer history" 
                  subtitle="No items have been transferred to this shop yet." 
                  icon="history" 
                  palette={palette} 
                />
              }
              renderItem={({ item }) => (
                <YStack 
                  backgroundColor={palette.card} 
                  borderColor={palette.border} 
                  borderWidth={1} 
                  borderRadius={12} 
                  padding={16}
                >
                  <XStack alignItems="center" gap={12}>
                    <YStack flex={1}>
                      <Text style={[styles.historyItemName, { color: palette.textPrimary }]}>{item.inventory_item_name}</Text>
                      <Text style={[styles.historyItemTamil, { color: palette.textSecondary }]}>{item.inventory_item_tamil_name}</Text>
                      <Text style={[styles.historyDate, { color: palette.textMuted }]}>{formatDateTime(item.occurred_at)} · From: {item.source_shop_name}</Text>
                    </YStack>
                    <YStack alignItems="flex-end" justifyContent="center">
                      <Text style={[styles.historyQty, { color: palette.inventory }]}>{item.quantity}</Text>
                      <Text style={[styles.historyUnit, { color: palette.textSecondary }]}>{item.unit}</Text>
                    </YStack>
                  </XStack>
                </YStack>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter-Medium",
  },
  rowTitle: {
    fontSize: 17,
    fontFamily: "Inter-SemiBold",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "Inter-SemiBold",
  },
  rowSubtitle: {
    fontSize: 14,
    fontFamily: "Inter-Regular",
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "86%",
    borderRadius: 16,
    ...adminElevation(3),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter-SemiBold",
  },
  fullModalOverlay: {
    flex: 1,
  },
  fullModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  fullModalTitle: {
    fontSize: 18,
    fontFamily: "Inter-SemiBold",
  },
  historyItemName: {
    fontSize: 16,
    fontFamily: "Inter-SemiBold",
  },
  historyItemTamil: {
    fontSize: 14,
    fontFamily: "Inter-Regular",
    marginTop: 2,
  },
  historyDate: {
    fontSize: 12,
    fontFamily: "Inter-Medium",
    marginTop: 6,
  },
  historyQty: {
    fontSize: 20,
    fontFamily: "Inter-Bold",
  },
  historyUnit: {
    fontSize: 14,
    fontFamily: "Inter-Medium",
  },
});
