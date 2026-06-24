import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createTransferShop,
  fetchInventoryTransfersPage,
  fetchTransferShops,
  updateTransferShop,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import { BaseUnit, type InventoryTransferRead, type TransferShopRead, type UUID } from "@/types/api";
import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import type { ThemePalette } from "../admin-dashboard-theme";
import { money } from "@/utils/decimal";

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
    <View style={[styles.row, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: item.is_active ? palette.inventorySoft : palette.surfaceMuted }]}>
            <Text style={[styles.badgeText, { color: item.is_active ? palette.inventory : palette.textMuted }]}>
              {item.is_active ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>
        <Text style={[styles.rowSubtitle, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
        
        <View style={styles.rowActions}>
          <Pressable style={styles.actionBtn} onPress={() => {
            setEditName(item.name);
            setEditTamilName(item.tamil_name);
            setEditingShop(item);
          }}>
            <MaterialCommunityIcons name="pencil-outline" size={20} color={palette.textSecondary} />
            <Text style={[styles.actionBtnText, { color: palette.textSecondary }]}>Edit</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => toggleActive(item)}>
            <MaterialCommunityIcons name={item.is_active ? "cancel" : "check"} size={20} color={palette.textSecondary} />
            <Text style={[styles.actionBtnText, { color: palette.textSecondary }]}>{item.is_active ? "Deactivate" : "Activate"}</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => loadHistory(item)}>
            <MaterialCommunityIcons name="history" size={20} color={palette.inventory} />
            <Text style={[styles.actionBtnText, { color: palette.inventory }]}>History</Text>
          </Pressable>
        </View>
      </View>
    </View>
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
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card, borderRadius: 14, paddingHorizontal: 12, height: 46 }}>
          <MaterialCommunityIcons name="magnify" size={20} color={palette.textSecondary} />
          <TextInput
            style={{ flex: 1, marginLeft: 8, fontSize: 15, color: palette.textPrimary }}
            placeholder="Search transfer shops..."
            placeholderTextColor={palette.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <Pressable
          style={{ height: 46, paddingHorizontal: 16, backgroundColor: palette.inventory, borderRadius: 14, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 }}
          onPress={() => setCreateModalOpen(true)}
        >
          <MaterialCommunityIcons name="plus" size={18} color={palette.onPrimary} />
          <Text style={{ color: palette.onPrimary, fontSize: 14, fontWeight: '700' }}>Add</Text>
        </Pressable>
      </View>

      {/* LIST */}
      <FlatList
        data={filteredShops}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={palette.inventory} />}
        ListEmptyComponent={
          !loading ? <Text style={[styles.emptyText, { color: palette.textMuted }]}>No transfer shops found.</Text> : null
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
              <Pressable onPress={() => setCreateModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>English Name</Text>
              <TextInput
                style={[styles.input, { borderColor: palette.border, color: palette.textPrimary, backgroundColor: palette.surfaceMuted, marginBottom: 12 }]}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Shop Name"
                placeholderTextColor={palette.textMuted}
              />
              <Text style={[styles.label, { color: palette.textSecondary }]}>Tamil Name</Text>
              <TextInput
                style={[styles.input, { borderColor: palette.border, color: palette.textPrimary, backgroundColor: palette.surfaceMuted, marginBottom: 24 }]}
                value={draftTamilName}
                onChangeText={setDraftTamilName}
                placeholder="Shop Tamil Name"
                placeholderTextColor={palette.textMuted}
              />
              <Pressable
                style={[styles.modalBtn, { backgroundColor: draftName && draftTamilName ? palette.inventory : palette.surfaceMuted }]}
                disabled={!draftName || !draftTamilName || saving}
                onPress={handleCreate}
              >
                {saving ? <ActivityIndicator size="small" color={palette.onPrimary} /> : <Text style={[styles.modalBtnText, { color: draftName && draftTamilName ? palette.onPrimary : palette.textMuted }]}>Create Shop</Text>}
              </Pressable>
            </View>
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
              <Pressable onPress={() => setEditingShop(null)}>
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>English Name</Text>
              <TextInput
                style={[styles.input, { borderColor: palette.border, color: palette.textPrimary, backgroundColor: palette.surfaceMuted, marginBottom: 12 }]}
                value={editName}
                onChangeText={setEditName}
              />
              <Text style={[styles.label, { color: palette.textSecondary }]}>Tamil Name</Text>
              <TextInput
                style={[styles.input, { borderColor: palette.border, color: palette.textPrimary, backgroundColor: palette.surfaceMuted, marginBottom: 24 }]}
                value={editTamilName}
                onChangeText={setEditTamilName}
              />
              <Pressable
                style={[styles.modalBtn, { backgroundColor: palette.inventory }]}
                disabled={!editName || !editTamilName || saving}
                onPress={handleUpdate}
              >
                {saving ? <ActivityIndicator size="small" color={palette.onPrimary} /> : <Text style={[styles.modalBtnText, { color: palette.onPrimary }]}>Save Changes</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* HISTORY MODAL */}
      <Modal visible={!!historyShop} transparent animationType="slide">
        <View style={[styles.fullModalOverlay, { backgroundColor: palette.shell }]}>
          <View style={[styles.fullModalHeader, { borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top, 16) }]}>
            <Pressable onPress={() => setHistoryShop(null)}>
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
              ListEmptyComponent={<Text style={[styles.emptyText, { color: palette.textMuted }]}>No transfer history found.</Text>}
              renderItem={({ item }) => (
                <View style={[styles.historyRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
                  <View style={styles.historyRowMain}>
                    <Text style={[styles.historyItemName, { color: palette.textPrimary }]}>{item.inventory_item_name}</Text>
                    <Text style={[styles.historyItemTamil, { color: palette.textSecondary }]}>{item.inventory_item_tamil_name}</Text>
                    <Text style={[styles.historyDate, { color: palette.textMuted }]}>{new Date(item.created_at).toLocaleString()}</Text>
                    <Text style={[styles.historyDate, { color: palette.textMuted }]}>From: {item.source_shop_name}</Text>
                  </View>
                  <View style={styles.historyQtyBox}>
                    <Text style={[styles.historyQty, { color: palette.inventory }]}>{item.quantity}</Text>
                    <Text style={[styles.historyUnit, { color: palette.textSecondary }]}>{item.unit}</Text>
                  </View>
                </View>
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
  createBox: {
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  createTitle: {
    fontSize: 16,
    fontFamily: "Inter-SemiBold",
    marginBottom: 12,
  },
  createForm: {
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    fontFamily: "Inter-Medium",
    fontSize: 15,
  },
  addBtn: {
    height: 44,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addBtnText: {
    fontFamily: "Inter-SemiBold",
    fontSize: 15,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  rowContent: {},
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowTitle: {
    fontSize: 16,
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
    marginTop: 4,
  },
  rowActions: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
    gap: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: "Inter-Medium",
  },
  emptyText: {
    textAlign: "center",
    marginTop: 32,
    fontFamily: "Inter-Regular",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalContent: {
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter-SemiBold",
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter-Medium",
    marginBottom: 6,
  },
  modalBtn: {
    height: 48,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  modalBtnText: {
    fontFamily: "Inter-SemiBold",
    fontSize: 16,
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
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  historyRowMain: {
    flex: 1,
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
    marginTop: 4,
  },
  historyQtyBox: {
    alignItems: "flex-end",
    justifyContent: "center",
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
