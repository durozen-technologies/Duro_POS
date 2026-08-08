import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAdminTranslation } from "@/hooks/use-admin-translation";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { XStack, YStack } from "tamagui";

import { createPurchaser, fetchPurchasers, updatePurchaser } from "@/api/admin";
import { isApiRequestCanceled, formatApiErrorMessage } from "@/api/client";
import { type PurchaserRead } from "@/types/api";
import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import { ActionButton, EmptyStateCard, SearchField } from "./admin-dashboard-primitives";
import { AdminTextField } from "./admin-text-field";

function getRequestMessage(error: unknown, fallback: string) {
  return formatApiErrorMessage(error, fallback);
}

export function AdminPurchasersTab() {
  const { t } = useAdminTranslation();
  const { palette } = useAdminTheme();

  const [purchasers, setPurchasers] = useState<PurchaserRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftTamilName, setDraftTamilName] = useState("");
  const [draftShopName, setDraftShopName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingPurchaser, setEditingPurchaser] = useState<PurchaserRead | null>(null);
  const [editName, setEditName] = useState("");
  const [editTamilName, setEditTamilName] = useState("");
  const [editShopName, setEditShopName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const data = await fetchPurchasers();
      setPurchasers(data);
    } catch (error) {
      if (!isApiRequestCanceled(error)) {
        triggerHaptic();
        setErrorMessage(getRequestMessage(error, "Unable to load purchasers."));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredPurchasers = useMemo(() => {
    if (!searchQuery.trim()) return purchasers;
    const lower = searchQuery.trim().toLowerCase();
    return purchasers.filter(
      (row) =>
        row.name.toLowerCase().includes(lower) ||
        (row.tamil_name ?? "").toLowerCase().includes(lower) ||
        (row.shop_name ?? "").toLowerCase().includes(lower) ||
        (row.phone ?? "").toLowerCase().includes(lower),
    );
  }, [purchasers, searchQuery]);

  const resetCreateDraft = () => {
    setDraftName("");
    setDraftTamilName("");
    setDraftShopName("");
    setDraftPhone("");
    setDraftAddress("");
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    const tamil_name = draftTamilName.trim();
    if (!name || !tamil_name) return;

    setSaving(true);
    setErrorMessage(null);
    try {
      await createPurchaser({
        name,
        tamil_name,
        shop_name: draftShopName.trim() || null,
        phone: draftPhone.trim() || null,
        address: draftAddress.trim() || null,
        is_active: true,
      });
      resetCreateDraft();
      setCreateModalOpen(false);
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to create purchaser."));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingPurchaser) return;
    const name = editName.trim();
    const tamil_name = editTamilName.trim();
    if (!name || !tamil_name) return;

    setSaving(true);
    setErrorMessage(null);
    try {
      await updatePurchaser(editingPurchaser.id, {
        name,
        tamil_name,
        shop_name: editShopName.trim() || null,
        phone: editPhone.trim() || null,
        address: editAddress.trim() || null,
        is_active: editIsActive,
      });
      setEditingPurchaser(null);
      await loadData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update purchaser."));
    } finally {
      setSaving(false);
    }
  };

  const renderRow = ({ item }: { item: PurchaserRead }) => (
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
          <View
            style={[
              styles.badge,
              { backgroundColor: item.is_active ? palette.inventorySoft : palette.surfaceMuted },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: item.is_active ? palette.inventory : palette.textMuted },
              ]}
            >
              {item.is_active ? t("common.active") : t("common.inactive")}
            </Text>
          </View>
        </XStack>
        <Text style={[styles.rowSubtitle, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
        {item.shop_name ? (
          <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{item.shop_name}</Text>
        ) : null}
        {item.phone ? (
          <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{item.phone}</Text>
        ) : null}
        {item.address ? (
          <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={2}>
            {item.address}
          </Text>
        ) : null}
      </YStack>

      <XStack paddingTop={16} borderTopWidth={1} borderTopColor={palette.border} gap={12}>
        <ActionButton
          label={t("retailers.edit")}
          icon="pencil-outline"
          palette={palette}
          onPress={() => {
            setEditName(item.name);
            setEditTamilName(item.tamil_name);
            setEditShopName(item.shop_name ?? "");
            setEditPhone(item.phone ?? "");
            setEditAddress(item.address ?? "");
            setEditIsActive(item.is_active);
            setEditingPurchaser(item);
          }}
        />
      </XStack>
    </YStack>
  );

  return (
    <View style={styles.container}>
      {errorMessage ? (
        <View
          style={[
            styles.errorBox,
            { borderColor: palette.danger, backgroundColor: palette.dangerSoft },
          ]}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}

      <XStack paddingHorizontal={16} paddingTop={16} paddingBottom={8} gap={12}>
        <YStack flex={1}>
          <SearchField
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("purchasers.search")}
            palette={palette}
          />
        </YStack>
        <ActionButton
          label={t("retailers.add")}
          icon="plus"
          palette={palette}
          tone="success"
          active
          onPress={() => setCreateModalOpen(true)}
        />
      </XStack>

      <FlatList
        data={filteredPurchasers}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={palette.inventory}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <EmptyStateCard
              title={t("purchasers.none")}
              subtitle={
                searchQuery
                  ? "Try a different search query."
                  : "You haven't added any purchasers yet."
              }
              icon="account-tie-outline"
              palette={palette}
              actionLabel={!searchQuery ? t("purchasers.add") : undefined}
              onAction={!searchQuery ? () => setCreateModalOpen(true) : undefined}
            />
          ) : null
        }
      />

      <Modal visible={createModalOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
        >
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>{t("purchasers.add")}</Text>
              <Pressable
                hitSlop={12}
                onPress={() => {
                  resetCreateDraft();
                  setCreateModalOpen(false);
                }}
              >
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <YStack padding={20} gap={16}>
              <AdminTextField
                label={t("retailers.name")}
                placeholder={t("forms.purchaserName")}
                value={draftName}
                onChangeText={setDraftName}
                palette={palette}
              />
              <AdminTextField
                label={t("forms.tamilName")}
                placeholder={t("forms.tamilName")}
                value={draftTamilName}
                onChangeText={setDraftTamilName}
                palette={palette}
              />
              <AdminTextField
                label={t("forms.shopName")}
                placeholder={t("forms.businessName")}
                value={draftShopName}
                onChangeText={setDraftShopName}
                palette={palette}
              />
              <AdminTextField
                label={t("retailers.mobile")}
                placeholder="Mobile number"
                value={draftPhone}
                onChangeText={setDraftPhone}
                palette={palette}
                keyboardType="phone-pad"
              />
              <AdminTextField
                label={t("retailers.address")}
                placeholder={t("retailers.address")}
                value={draftAddress}
                onChangeText={setDraftAddress}
                palette={palette}
              />
              <XStack paddingTop={8}>
                <ActionButton
                  label={t("purchasers.create")}
                  icon="check"
                  palette={palette}
                  tone="success"
                  active
                  disabled={!draftName.trim() || !draftTamilName.trim() || saving}
                  loading={saving}
                  onPress={handleCreate}
                />
              </XStack>
            </YStack>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editingPurchaser} transparent animationType="fade">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { backgroundColor: palette.overlay }]}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
        >
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>{t("purchasers.edit")}</Text>
              <Pressable hitSlop={12} onPress={() => setEditingPurchaser(null)}>
                <MaterialCommunityIcons name="close" size={24} color={palette.textSecondary} />
              </Pressable>
            </View>
            <YStack padding={20} gap={16}>
              <AdminTextField
                label={t("retailers.name")}
                value={editName}
                onChangeText={setEditName}
                palette={palette}
              />
              <AdminTextField
                label={t("forms.tamilName")}
                value={editTamilName}
                onChangeText={setEditTamilName}
                palette={palette}
              />
              <AdminTextField
                label={t("forms.shopName")}
                value={editShopName}
                onChangeText={setEditShopName}
                palette={palette}
              />
              <AdminTextField
                label={t("retailers.mobile")}
                value={editPhone}
                onChangeText={setEditPhone}
                palette={palette}
                keyboardType="phone-pad"
              />
              <AdminTextField
                label={t("retailers.address")}
                value={editAddress}
                onChangeText={setEditAddress}
                palette={palette}
              />
              <XStack alignItems="center" justifyContent="space-between" paddingTop={4}>
                <YStack gap={2}>
                  <Text style={[styles.modalTitle, { fontSize: 15, color: palette.textPrimary }]}>
                    {t("common.active")}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: palette.textSecondary,
                      fontFamily: "Inter-Regular",
                    }}
                  >
                    {editIsActive
                      ? "Active (Shown in Add Stock)"
                      : "Inactive (Hidden from Add Stock)"}
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
                  label={t("action.saveChanges")}
                  icon="content-save-outline"
                  palette={palette}
                  tone="success"
                  active
                  disabled={!editName.trim() || !editTamilName.trim() || saving}
                  loading={saving}
                  onPress={handleUpdate}
                />
              </XStack>
            </YStack>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorBox: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter-Medium",
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: "Inter-SemiBold",
    flex: 1,
    paddingRight: 8,
  },
  rowSubtitle: {
    fontSize: 14,
    fontFamily: "Inter-Medium",
  },
  rowMeta: {
    fontSize: 13,
    fontFamily: "Inter-Regular",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "Inter-SemiBold",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    borderRadius: 16,
    overflow: "hidden",
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter-SemiBold",
  },
});
