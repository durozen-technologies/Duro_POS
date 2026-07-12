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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XStack, YStack } from "tamagui";

import {
  createTransferShop,
  deleteTransferShop,
  fetchInventoryTransfersPage,
  fetchTransferShops,
  updateTransferShop,
  fetchShops,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError, formatApiErrorMessage } from "@/api/client";
import { type InventoryTransferRead, type TransferShopRead, BaseUnit, type ShopRead } from "@/types/api";
import {
  CalendarDateField,
  CalendarDatePickerModal,
  formatCalendarDateLabel,
  type CalendarPickerColors,
} from "@/components/ui/calendar-date-picker";
import { toDateInputValue } from "@/utils/expense-history-filters";
import { formatDateTime } from "@/utils/format";
import { adminElevation } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import { ActionButton, EmptyStateCard, SearchField } from "./admin-dashboard-primitives";
import { AdminTextField } from "./admin-text-field";

function getRequestMessage(error: unknown, fallback: string) {
  return formatApiErrorMessage(error, fallback);
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
  const [editIsActive, setEditIsActive] = useState(true);
  const [deleting, setDeleting] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  
  const [historyShop, setHistoryShop] = useState<TransferShopRead | null>(null);
  const [historyItems, setHistoryItems] = useState<InventoryTransferRead[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // History filters
  const [historySearch, setHistorySearch] = useState("");
  const [historyQuantity, setHistoryQuantity] = useState("");
  const [historySourceShopId, setHistorySourceShopId] = useState<string | null>(null);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchShops, setBranchShops] = useState<ShopRead[]>([]);
  const [historyUnitKg, setHistoryUnitKg] = useState(false);
  const [historyDateMode, setHistoryDateMode] = useState<"date" | "range" | "month">("date");
  const [historyDate, setHistoryDate] = useState(() => toDateInputValue(new Date()));
  const [historyRangeStart, setHistoryRangeStart] = useState(() => toDateInputValue(new Date()));
  const [historyRangeEnd, setHistoryRangeEnd] = useState(() => toDateInputValue(new Date()));
  const [historyCalendarTarget, setHistoryCalendarTarget] = useState<"date" | "start" | "end" | null>(null);
  
  const movementCalendarColors = useMemo<CalendarPickerColors>(
    () => ({
      overlay: palette.overlay,
      card: palette.card,
      surface: palette.surfaceMuted,
      border: palette.border,
      textPrimary: palette.textPrimary,
      textSecondary: palette.textSecondary,
      textMuted: palette.textMuted,
      accent: palette.inventory,
      accentSoft: palette.inventorySoft,
      onAccent: palette.onPrimary,
    }),
    [palette],
  );

  const historyFilterParams = useMemo(() => {
    return historyDateMode === "date"
      ? {
          referenceDate: historyDate,
          range: undefined,
        }
      : {
          referenceDate: undefined,
          range: {
            startDate: historyRangeStart,
            endDate: historyRangeEnd,
          },
        };
  }, [historyDateMode, historyDate, historyRangeStart, historyRangeEnd]);

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
      await updateTransferShop(editingShop.id, { name, tamil_name, is_active: editIsActive });
      setEditingShop(null);
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update transfer shop."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(() => {
    if (!editingShop || editingShop.has_history) {
      return;
    }
    Alert.alert(
      "Delete transfer shop",
      `Permanently delete "${editingShop.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeleting(true);
              setErrorMessage(null);
              try {
                await deleteTransferShop(editingShop.id);
                triggerHaptic();
                setEditingShop(null);
                await loadData(true);
              } catch (error) {
                triggerHaptic();
                setErrorMessage(getRequestMessage(error, "Unable to delete transfer shop."));
              } finally {
                setDeleting(false);
              }
            })();
          },
        },
      ],
    );
  }, [editingShop, loadData]);

  const loadHistory = async (shop: TransferShopRead, filters = {
    search: historySearch,
    sourceShopId: historySourceShopId,
    unitKg: historyUnitKg,
    quantity: historyQuantity,
    dateParams: historyFilterParams,
  }) => {
    setHistoryShop(shop);
    setHistoryLoading(true);
    setHistoryItems([]);
    try {
      if (branchShops.length === 0) {
        const shopsData = await fetchShops();
        setBranchShops(shopsData);
      }
      const data = await fetchInventoryTransfersPage({ 
        transfer_shop_id: shop.id,
        source_shop_id: filters.sourceShopId || undefined,
        q: filters.search || undefined,
        unit: filters.unitKg ? BaseUnit.KG : undefined,
        quantity: filters.quantity ? parseFloat(filters.quantity) : undefined,
        ...filters.dateParams,
      });
      setHistoryItems(data.items);
    } catch (error) {
      if (!isApiRequestCanceled(error)) {
        triggerHaptic();
        setErrorMessage(getRequestMessage(error, "Unable to load transfer history."));
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  // Reload history when filters change
  useEffect(() => {
    if (historyShop && !createModalOpen && !editingShop) {
      void loadHistory(historyShop, {
        search: historySearch,
        sourceShopId: historySourceShopId,
        unitKg: historyUnitKg,
        quantity: historyQuantity,
        dateParams: historyFilterParams,
      });
    }
  }, [historySearch, historySourceShopId, historyUnitKg, historyQuantity, historyFilterParams]);

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
            setEditIsActive(item.is_active);
            setEditingShop(item);
          }} 
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
              <XStack alignItems="center" justifyContent="space-between" paddingTop={4}>
                <YStack gap={2}>
                  <Text style={[styles.modalTitle, { fontSize: 15, color: palette.textPrimary }]}>Status</Text>
                  <Text style={{ fontSize: 13, color: palette.textSecondary, fontFamily: "Inter-Regular" }}>
                    {editIsActive ? "Active (Can receive transfers)" : "Inactive (Hidden from transfers)"}
                  </Text>
                </YStack>
                <Switch
                  value={editIsActive}
                  onValueChange={setEditIsActive}
                  trackColor={{ false: palette.border, true: palette.inventory }}
                  thumbColor={Platform.OS === "ios" ? undefined : palette.card}
                />
              </XStack>
              <XStack paddingTop={8}>
                <ActionButton 
                  label="Save Changes" 
                  icon="content-save-outline" 
                  palette={palette} 
                  tone="success" 
                  active 
                  disabled={!editName || !editTamilName || saving || deleting}
                  loading={saving}
                  onPress={handleUpdate} 
                />
              </XStack>

              <View style={[styles.deleteSection, { borderTopColor: palette.border }]}>
                <Text style={[styles.deleteSectionLabel, { color: palette.textMuted }]}>
                  Danger zone
                </Text>
                <ActionButton
                  label="Delete shop"
                  icon="trash-can-outline"
                  palette={palette}
                  tone="danger"
                  disabled={editingShop?.has_history || saving || deleting}
                  loading={deleting}
                  onPress={handleDelete}
                />
                {editingShop?.has_history ? (
                  <Text style={[styles.deleteBlockedText, { color: palette.warning }]}>
                    Cannot Delete, has Billing History.
                  </Text>
                ) : (
                  <Text style={[styles.deleteHintText, { color: palette.textMuted }]}>
                    Only shops without transfer history can be deleted.
                  </Text>
                )}
              </View>
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
          
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12, backgroundColor: palette.card, borderBottomWidth: 1, borderBottomColor: palette.border }}>
            <SearchField 
              value={historySearch}
              onChangeText={setHistorySearch}
              placeholder="Search items or branch..."
              palette={palette}
            />
            <XStack gap={8} flexWrap="wrap">
              <View style={[styles.historyBar, { flex: 1, borderColor: palette.border, backgroundColor: palette.surfaceMuted, minWidth: 200 }]}>
                <Pressable
                  onPress={() => setHistoryDateMode(historyDateMode === "date" ? "range" : "date")}
                  style={[styles.historyBarIcon, { backgroundColor: palette.inventorySoft }]}
                >
                  <MaterialCommunityIcons 
                    name={historyDateMode === "date" ? "calendar-today" : "calendar-range"} 
                    size={16} 
                    color={palette.inventoryStrong} 
                  />
                </Pressable>
                <View style={styles.historyBarContent}>
                  <Text style={[styles.historyBarLabel, { color: palette.textMuted }]}>
                    {historyDateMode === "date" ? "DATE" : "RANGE"}
                  </Text>
                  <XStack gap={8} alignItems="center">
                    {historyDateMode === "date" ? (
                      <Pressable onPress={() => setHistoryCalendarTarget("date")}>
                        <Text style={[styles.historyDateBtnText, { color: palette.textPrimary }]}>
                          {formatCalendarDateLabel(historyDate)}
                        </Text>
                      </Pressable>
                    ) : (
                      <>
                        <Pressable onPress={() => setHistoryCalendarTarget("start")}>
                          <Text style={[styles.historyDateBtnText, { color: palette.textPrimary }]}>
                            {formatCalendarDateLabel(historyRangeStart)}
                          </Text>
                        </Pressable>
                        <Text style={[styles.historyDateBtnText, { color: palette.textMuted }]}>to</Text>
                        <Pressable onPress={() => setHistoryCalendarTarget("end")}>
                          <Text style={[styles.historyDateBtnText, { color: palette.textPrimary }]}>
                            {formatCalendarDateLabel(historyRangeEnd)}
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </XStack>
                </View>
              </View>
              
              <View style={[styles.historyBar, { minWidth: 100, borderColor: palette.border, backgroundColor: palette.card }]}>
                <View style={styles.historyBarContent}>
                  <Text style={[styles.historyBarLabel, { color: palette.textMuted, paddingHorizontal: 12 }]}>
                    QTY (KG)
                  </Text>
                  <TextInput
                    value={historyQuantity}
                    onChangeText={setHistoryQuantity}
                    keyboardType="numeric"
                    placeholder="Exact Kg..."
                    placeholderTextColor={palette.textMuted}
                    style={{ fontSize: 13, fontFamily: "Inter-SemiBold", color: palette.textPrimary, paddingHorizontal: 12, paddingVertical: 4 }}
                  />
                </View>
              </View>

              <View style={{ position: "relative", minWidth: 160, zIndex: 10 }}>
                <Pressable
                  onPress={() => setBranchDropdownOpen(!branchDropdownOpen)}
                  style={[styles.historyBar, { borderColor: branchDropdownOpen ? palette.inventory : palette.border, backgroundColor: palette.card, paddingLeft: 12 }]}
                >
                  <View style={styles.historyBarContent}>
                    <Text style={[styles.historyBarLabel, { color: palette.textMuted }]}>
                      BRANCH
                    </Text>
                    <Text numberOfLines={1} style={[styles.historyDateBtnText, { color: historySourceShopId ? palette.textPrimary : palette.textMuted }]}>
                      {historySourceShopId ? branchShops.find(s => s.id === historySourceShopId)?.name : "All Branches"}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name={branchDropdownOpen ? "chevron-up" : "chevron-down"} size={18} color={palette.textMuted} />
                </Pressable>
                
                {branchDropdownOpen && (
                  <View style={[styles.dropdownMenu, { borderColor: palette.border, backgroundColor: palette.card, position: "absolute", top: 44, left: 0, right: 0, zIndex: 10 }]}>
                    <Pressable
                      onPress={() => {
                        setHistorySourceShopId(null);
                        setBranchDropdownOpen(false);
                      }}
                      style={[styles.dropdownOption, { backgroundColor: !historySourceShopId ? palette.inventorySoft : "transparent", borderColor: !historySourceShopId ? palette.inventory : "transparent" }]}
                    >
                      <Text style={[styles.dropdownOptionText, { color: !historySourceShopId ? palette.inventoryStrong : palette.textPrimary }]}>
                        All Branches
                      </Text>
                    </Pressable>
                    {branchShops.map(shop => {
                      const active = shop.id === historySourceShopId;
                      return (
                        <Pressable
                          key={shop.id}
                          onPress={() => {
                            setHistorySourceShopId(shop.id);
                            setBranchDropdownOpen(false);
                          }}
                          style={[styles.dropdownOption, { backgroundColor: active ? palette.inventorySoft : "transparent", borderColor: active ? palette.inventory : "transparent" }]}
                        >
                          <Text numberOfLines={1} style={[styles.dropdownOptionText, { color: active ? palette.inventoryStrong : palette.textPrimary }]}>
                            {shop.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            </XStack>
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
          
          {/* Calendar Picker for History */}
          <CalendarDatePickerModal
            visible={!!historyCalendarTarget}
            title={
              historyCalendarTarget === "start"
                ? "From"
                : historyCalendarTarget === "end"
                  ? "To"
                  : "History date"
            }
            value={
              historyCalendarTarget === "start"
                ? historyRangeStart
                : historyCalendarTarget === "end"
                  ? historyRangeEnd
                  : historyDate
            }
            rangeStartDate={historyDateMode === "range" ? historyRangeStart : null}
            rangeEndDate={historyDateMode === "range" ? historyRangeEnd : null}
            colors={movementCalendarColors}
            onSelect={(date) => {
              if (historyCalendarTarget === "date") {
                setHistoryDate(date);
              } else if (historyCalendarTarget === "start") {
                setHistoryRangeStart(date);
              } else if (historyCalendarTarget === "end") {
                setHistoryRangeEnd(date);
              }
              setHistoryCalendarTarget(null);
            }}
            onClose={() => setHistoryCalendarTarget(null)}
          />
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
  deleteSection: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  deleteSectionLabel: {
    fontSize: 12,
    fontFamily: "Inter-SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  deleteBlockedText: {
    fontSize: 13,
    fontFamily: "Inter-Medium",
    lineHeight: 18,
  },
  deleteHintText: {
    fontSize: 13,
    fontFamily: "Inter-Regular",
    lineHeight: 18,
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
  historyBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingRight: 8,
    height: 40,
  },
  historyBarIcon: {
    padding: 8,
    borderTopLeftRadius: 7,
    borderBottomLeftRadius: 7,
    marginRight: 8,
    height: "100%",
    justifyContent: "center",
  },
  historyBarContent: {
    flex: 1,
    paddingVertical: 4,
  },
  historyBarLabel: {
    fontSize: 10,
    fontFamily: "Inter-Bold",
    letterSpacing: 0.5,
  },
  historyDateBtnText: {
    fontSize: 13,
    fontFamily: "Inter-SemiBold",
  },
  filterToggleBtn: {
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    height: 40,
  },
  filterToggleBtnText: {
    fontSize: 13,
    fontFamily: "Inter-SemiBold",
  },
  dropdownMenu: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    gap: 4,
    ...adminElevation(2),
  },
  dropdownOption: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownOptionText: {
    fontSize: 14,
    fontFamily: "Inter-SemiBold",
  },
});
