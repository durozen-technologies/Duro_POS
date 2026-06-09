import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Button as TButton, Input, Spinner, XStack, YStack } from "tamagui";

import {
  createItemCategory,
  deleteItemCategory,
  fetchItemCategories,
  updateItemCategory,
} from "@/api/admin";
import { isApiRequestCanceled, toApiError } from "@/api/client";
import type { AdminItemCategoriesScreenProps } from "@/navigation/types";
import type { ItemCategoryRead, UUID } from "@/types/api";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

function sortedCategories(categories: ItemCategoryRead[]) {
  return [...categories].sort((left, right) => left.name.localeCompare(right.name));
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  const apiError = toApiError(error);
  return apiError.message || fallback;
}

export function AdminItemCategoriesScreen({ navigation }: AdminItemCategoriesScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState<ItemCategoryRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<UUID | null>(null);
  const [deletingId, setDeletingId] = useState<UUID | null>(null);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<UUID | null>(null);
  const [editingName, setEditingName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCategories = useCallback(async (signal?: AbortSignal, refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const nextCategories = await fetchItemCategories({ signal });
      setCategories(nextCategories);
      setErrorMessage(null);
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return;
      }
      triggerHaptic();
      setErrorMessage(getRequestErrorMessage(requestError, "Unable to load categories."));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCategories(controller.signal);
    return () => controller.abort();
  }, [loadCategories]);

  const addCategory = useCallback(async () => {
    const categoryName = draftName.trim();
    if (!categoryName) {
      triggerHaptic();
      setErrorMessage("Enter a category name.");
      return;
    }
    setCreating(true);
    setErrorMessage(null);
    try {
      const createdCategory = await createItemCategory({ name: categoryName });
      setCategories((current) => sortedCategories([...current, createdCategory]));
      setDraftName("");
    } catch (requestError) {
      triggerHaptic();
      setErrorMessage(getRequestErrorMessage(requestError, "Unable to create category."));
    } finally {
      setCreating(false);
    }
  }, [draftName]);

  const beginRename = useCallback((category: ItemCategoryRead) => {
    setEditingId(category.id);
    setEditingName(category.name);
    setErrorMessage(null);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName("");
  }, []);

  const saveRename = useCallback(async (category: ItemCategoryRead) => {
    const categoryName = editingName.trim();
    if (!categoryName) {
      triggerHaptic();
      setErrorMessage("Enter a category name.");
      return;
    }
    if (categoryName === category.name) {
      cancelRename();
      return;
    }
    setSavingId(category.id);
    setErrorMessage(null);
    try {
      const updatedCategory = await updateItemCategory(category.id, { name: categoryName });
      setCategories((current) =>
        sortedCategories(
          current.map((candidate) => (candidate.id === updatedCategory.id ? updatedCategory : candidate)),
        ),
      );
      cancelRename();
    } catch (requestError) {
      triggerHaptic();
      setErrorMessage(getRequestErrorMessage(requestError, "Unable to rename category."));
    } finally {
      setSavingId(null);
    }
  }, [cancelRename, editingName]);

  const deleteCategory = useCallback(async (category: ItemCategoryRead) => {
    setDeletingId(category.id);
    setErrorMessage(null);
    try {
      await deleteItemCategory(category.id);
      setCategories((current) => current.filter((candidate) => candidate.id !== category.id));
      if (editingId === category.id) {
        cancelRename();
      }
    } catch (requestError) {
      triggerHaptic();
      setErrorMessage(getRequestErrorMessage(requestError, "Unable to delete category."));
    } finally {
      setDeletingId(null);
    }
  }, [cancelRename, editingId]);

  const confirmDelete = useCallback((category: ItemCategoryRead) => {
    Alert.alert("Delete category", `Delete ${category.name}? Items using it will become uncategorized.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteCategory(category);
        },
      },
    ]);
  }, [deleteCategory]);

  const renderHeader = () => (
    <YStack gap={14}>
      {errorMessage ? (
        <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadCategories(undefined, true)} hitSlop={10}>
            <Text style={[styles.errorAction, { color: palette.danger }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <YStack gap={8} flex={1}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Add category</Text>
          <XStack gap={8} alignItems="center">
            <Input
              value={draftName}
              onChangeText={setDraftName}
              placeholder="New category"
              placeholderTextColor={palette.textMuted as never}
              flex={1}
              minHeight={46}
              borderRadius={10}
              borderWidth={1}
              borderColor={palette.border}
              backgroundColor={palette.surfaceMuted}
              color={palette.textPrimary}
              fontSize={14}
              fontWeight="800"
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={() => void addCategory()}
            />
            <CategoryButton
              label={creating ? "Adding" : "Add"}
              icon="plus"
              palette={palette}
              active
              loading={creating}
              disabled={creating}
              onPress={() => void addCategory()}
            />
          </XStack>
        </YStack>
      </View>

      <Text style={[styles.listTitle, { color: palette.textMuted }]}>All categories</Text>
    </YStack>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            Categories
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            Manage catalogue groups
          </Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing}
          onRefresh={() => loadCategories(undefined, true)}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <Spinner color={palette.items} />
          <Text style={[styles.helper, { color: palette.textMuted }]}>Loading categories...</Text>
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(category) => category.id}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => void loadCategories(undefined, true)}
          contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
          ListHeaderComponent={renderHeader}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <MaterialCommunityIcons name="shape-outline" size={26} color={palette.textMuted} />
              <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>No categories yet</Text>
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>Add the first category above.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const editing = editingId === item.id;
            const rowBusy = savingId === item.id || deletingId === item.id;
            return (
              <View style={[styles.categoryRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
                {editing ? (
                  <XStack gap={8} alignItems="center" flex={1}>
                    <Input
                      value={editingName}
                      onChangeText={setEditingName}
                      placeholder="Category name"
                      placeholderTextColor={palette.textMuted as never}
                      flex={1}
                      minHeight={44}
                      borderRadius={10}
                      borderWidth={1}
                      borderColor={palette.border}
                      backgroundColor={palette.surfaceMuted}
                      color={palette.textPrimary}
                      fontSize={14}
                      fontWeight="800"
                      maxLength={80}
                      returnKeyType="done"
                      onSubmitEditing={() => void saveRename(item)}
                    />
                    <IconAction
                      icon="check"
                      label="Save category name"
                      color={palette.items}
                      disabled={rowBusy}
                      loading={savingId === item.id}
                      onPress={() => void saveRename(item)}
                    />
                    <IconAction
                      icon="close"
                      label="Cancel rename"
                      color={palette.textMuted}
                      disabled={rowBusy}
                      onPress={cancelRename}
                    />
                  </XStack>
                ) : (
                  <>
                    <View style={styles.categoryMain}>
                      <MaterialCommunityIcons name="shape-outline" size={18} color={palette.items} />
                      <Text numberOfLines={1} style={[styles.categoryName, { color: palette.textPrimary }]}>
                        {item.name}
                      </Text>
                    </View>
                    <XStack gap={4} alignItems="center">
                      <IconAction
                        icon="pencil-outline"
                        label={`Rename ${item.name}`}
                        color={palette.textMuted}
                        disabled={rowBusy}
                        onPress={() => beginRename(item)}
                      />
                      <IconAction
                        icon="delete-outline"
                        label={`Delete ${item.name}`}
                        color={palette.danger}
                        disabled={rowBusy}
                        loading={deletingId === item.id}
                        onPress={() => confirmDelete(item)}
                      />
                    </XStack>
                  </>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function CategoryButton({
  label,
  icon,
  active,
  loading,
  disabled,
  palette,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  palette: ThemePalette;
  onPress: () => void;
}) {
  const backgroundColor = active ? palette.items : palette.card;
  const borderColor = active ? palette.items : palette.border;
  const textColor = active ? palette.onPrimary : palette.textPrimary;
  return (
    <TButton
      accessibilityRole="button"
      onPress={onPress}
      disabled={loading || disabled}
      minHeight={44}
      borderRadius={12}
      borderWidth={1}
      borderColor={borderColor}
      backgroundColor={backgroundColor}
      opacity={disabled ? 0.56 : 1}
      pressStyle={{ opacity: 0.9, scale: 0.98 }}
    >
      {loading ? (
        <Spinner color={textColor} />
      ) : (
        <XStack gap={7} alignItems="center" justifyContent="center">
          <MaterialCommunityIcons name={icon} size={17} color={textColor} />
          <Text numberOfLines={1} style={[styles.buttonText, { color: textColor }]}>
            {label}
          </Text>
        </XStack>
      )}
    </TButton>
  );
}

function IconAction({
  icon,
  label,
  color,
  loading,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  color: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.iconAction, { opacity: disabled ? 0.5 : 1 }]}
      hitSlop={8}
    >
      {loading ? <Spinner size="small" color={color} /> : <MaterialCommunityIcons name={icon} size={20} color={color} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
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
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  content: {
    gap: 12,
    padding: 16,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  listTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  helper: {
    fontSize: 13,
    fontWeight: "700",
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  errorAction: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  categoryRow: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  categoryMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  categoryName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  iconAction: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "900",
    flexShrink: 1,
  },
  emptyBox: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
  },
});
