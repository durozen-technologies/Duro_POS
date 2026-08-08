import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { XStack, YStack } from "tamagui";

import { fetchInventoryWeightLoss, updateInventoryWeightLoss } from "@/api/admin";
import { formatApiErrorMessage, isApiRequestCanceled } from "@/api/client";
import { useAdminTranslation } from "@/hooks/use-admin-translation";
import type { InventoryWeightLossItemRead, UUID } from "@/types/api";

import { triggerHaptic } from "../admin-dashboard-utils";
import { useAdminTheme } from "../use-admin-theme";
import { EmptyStateCard, SearchField } from "./admin-dashboard-primitives";

export function AdminWeightLossTab() {
  const { t, translateItemName } = useAdminTranslation();
  const { palette } = useAdminTheme();

  const [items, setItems] = useState<InventoryWeightLossItemRead[]>([]);
  const [editingId, setEditingId] = useState<UUID | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingId, setSavingId] = useState<UUID | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const data = await fetchInventoryWeightLoss();
      setItems(data);
    } catch (error) {
      if (!isApiRequestCanceled(error)) {
        triggerHaptic();
        setErrorMessage(
          formatApiErrorMessage(error, t("weightLoss.loadFailed")),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return items;
    }
    const lower = searchQuery.trim().toLowerCase();
    return items.filter((row) => {
      const display = translateItemName(row.item_name, row.item_tamil_name).toLowerCase();
      return (
        display.includes(lower) ||
        row.item_name.toLowerCase().includes(lower) ||
        row.item_tamil_name.toLowerCase().includes(lower)
      );
    });
  }, [items, searchQuery, translateItemName]);

  const handleSave = useCallback(
    async (itemId: UUID) => {
      const raw = editingValue.trim();
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        triggerHaptic();
        setErrorMessage(t("weightLoss.invalidGrams"));
        return;
      }
      setSavingId(itemId);
      setErrorMessage(null);
      try {
        const updated = await updateInventoryWeightLoss(itemId, parsed);
        setItems((current) =>
          current.map((row) => (row.item_id === itemId ? updated : row)),
        );
        setEditingId(null);
        setEditingValue("");
        triggerHaptic();
      } catch (error) {
        if (!isApiRequestCanceled(error)) {
          triggerHaptic();
          setErrorMessage(formatApiErrorMessage(error, t("weightLoss.saveFailed")));
        }
      } finally {
        setSavingId(null);
      }
    },
    [editingValue, t],
  );

  const toggleEdit = useCallback(
    (item: InventoryWeightLossItemRead) => {
      if (editingId === item.item_id) {
        void handleSave(item.item_id);
        return;
      }
      setEditingId(item.item_id);
      setEditingValue(String(item.weight_loss_grams_per_day ?? 0));
    },
    [editingId, handleSave],
  );

  return (
    <YStack flex={1}>
      <XStack paddingHorizontal={16} paddingTop={16} paddingBottom={8} gap={12}>
        <YStack flex={1}>
          <SearchField
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("weightLoss.search")}
            palette={palette}
          />
        </YStack>
      </XStack>

      <Text style={[styles.helper, { color: palette.textMuted }]}>
        {t("weightLoss.helper")}
      </Text>

      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft }]}>
          <Text style={{ color: palette.danger }}>{errorMessage}</Text>
        </View>
      ) : null}

      {loading ? (
        <YStack flex={1} alignItems="center" justifyContent="center" padding={24}>
          <ActivityIndicator color={palette.primary} />
        </YStack>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadData(true)}
              tintColor={palette.primary}
            />
          }
          ListEmptyComponent={
            <EmptyStateCard
              title={t("weightLoss.emptyTitle")}
              subtitle={t("weightLoss.emptyDescription")}
              palette={palette}
            />
          }
          renderItem={({ item }) => {
            const editing = editingId === item.item_id;
            const saving = savingId === item.item_id;
            return (
              <View
                style={[
                  styles.row,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={styles.info}>
                  <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={1}>
                    {translateItemName(item.item_name, item.item_tamil_name)}
                  </Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {item.item_tamil_name}
                  </Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]}>
                    {item.is_active ? t("common.active") : t("common.inactive")} · kg
                  </Text>
                </View>

                <View
                  style={[
                    styles.panel,
                    {
                      borderColor: palette.border,
                      backgroundColor: palette.surfaceMuted,
                    },
                  ]}
                >
                  <Text style={[styles.panelLabel, { color: palette.textMuted }]}>
                    {t("weightLoss.gramsPerDay").toUpperCase()}
                  </Text>
                  {saving ? (
                    <ActivityIndicator
                      size="small"
                      color={palette.primary}
                      style={{ marginVertical: 4 }}
                    />
                  ) : editing ? (
                    <TextInput
                      value={editingValue}
                      onChangeText={(value) => setEditingValue(value.replace(/[^\d]/g, ""))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={palette.textMuted}
                      style={[
                        styles.panelValue,
                        {
                          color: palette.textPrimary,
                          borderBottomWidth: 1,
                          borderBottomColor: palette.primary,
                          minWidth: 56,
                        },
                      ]}
                      onSubmitEditing={() => void handleSave(item.item_id)}
                      autoFocus
                    />
                  ) : (
                    <Text style={[styles.panelValue, { color: palette.textPrimary }]}>
                      {item.weight_loss_grams_per_day ?? 0}
                    </Text>
                  )}
                  {!saving ? (
                    <Pressable
                      onPress={() => toggleEdit(item)}
                      hitSlop={8}
                      style={[
                        styles.editBtn,
                        {
                          backgroundColor: editing ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={editing ? "check" : "pencil-outline"}
                        size={13}
                        color={editing ? palette.onPrimary : palette.textSecondary}
                      />
                      <Text
                        style={[
                          styles.editBtnText,
                          { color: editing ? palette.onPrimary : palette.textSecondary },
                        ]}
                      >
                        {editing ? t("action.save") : t("action.edit")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </YStack>
  );
}

const styles = StyleSheet.create({
  helper: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 12,
    lineHeight: 16,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    padding: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  meta: {
    fontSize: 11,
    fontWeight: "600",
  },
  panel: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 96,
    gap: 4,
  },
  panelLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  panelValue: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 2,
  },
  editBtn: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
