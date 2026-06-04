import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createInventoryItemMetadata,
  deleteInventoryItemImage,
  fetchInventoryCategories,
  fetchInventoryItem,
  replaceInventoryItemImageFile,
  updateInventoryItemMetadata,
  type InventoryItemMetadataPayload,
  type ItemImageUploadFile,
} from "@/api/admin";
import { toApiError } from "@/api/client";
import {
  BaseUnit,
  UnitType,
  type InventoryCategoryRead,
  type InventoryItemRead,
  type UUID,
} from "@/types/api";
import { getItemThumbnailUri } from "@/utils/item-images";

import type { AdminInventoryItemEditorScreenProps } from "@/navigation/types";
import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

type ImageDraft = ItemImageUploadFile;

type InventoryEditorValues = {
  name: string;
  tamilName: string;
  unitType: UnitType;
  baseUnit: BaseUnit;
  sortOrder: string;
  isActive: boolean;
  categoryIds: Set<UUID>;
};

const EMPTY_VALUES: InventoryEditorValues = {
  name: "",
  tamilName: "",
  unitType: UnitType.WEIGHT,
  baseUnit: BaseUnit.KG,
  sortOrder: "0",
  isActive: true,
  categoryIds: new Set(),
};

function valuesFromItem(item: InventoryItemRead): InventoryEditorValues {
  return {
    name: item.name,
    tamilName: item.tamil_name,
    unitType: item.unit_type,
    baseUnit: item.base_unit,
    sortOrder: String(item.sort_order ?? 0),
    isActive: item.is_active,
    categoryIds: new Set(item.category_ids),
  };
}

function buildInventoryPayload(values: InventoryEditorValues): InventoryItemMetadataPayload {
  return {
    name: values.name.trim(),
    tamil_name: values.tamilName.trim(),
    unit_type: values.unitType,
    base_unit: values.baseUnit,
    sort_order: Number(values.sortOrder.trim() || 0),
    is_active: values.isActive,
    category_ids: [...values.categoryIds],
  };
}

function imageDraftFromAsset(asset: ImagePicker.ImagePickerAsset): ImageDraft {
  const contentType = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const suffix = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const name = (asset.fileName?.trim() || `inventory-${Date.now()}${suffix}`).replace(/[^a-zA-Z0-9._-]/g, "-");
  return { uri: asset.uri, name, type: contentType };
}

function getRequestMessage(error: unknown, fallback: string) {
  return toApiError(error).message || fallback;
}

export function AdminInventoryItemEditorScreen({
  navigation,
  route,
}: AdminInventoryItemEditorScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const initialItem = route.params?.initialItem ?? null;
  const itemId = route.params?.itemId ?? initialItem?.id ?? null;
  const savingRef = useRef(false);

  const [categories, setCategories] = useState<InventoryCategoryRead[]>([]);
  const [item, setItem] = useState<InventoryItemRead | null>(initialItem);
  const [values, setValues] = useState<InventoryEditorValues>(() =>
    initialItem ? valuesFromItem(initialItem) : EMPTY_VALUES,
  );
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentImageUri =
    imageDraft?.uri || (!removeImage && item ? getItemThumbnailUri(item) : "");
  const canRemoveImage = Boolean(imageDraft || item?.image_path || item?.image_thumb_path);
  const effectiveItemId = itemId ?? item?.id ?? null;
  const isEdit = Boolean(effectiveItemId);

  const loadEditorData = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setSaveError(null);
    try {
      const [nextCategories, loadedItem] = await Promise.all([
        fetchInventoryCategories(),
        itemId && !initialItem ? fetchInventoryItem(itemId) : Promise.resolve(initialItem),
      ]);
      setCategories(nextCategories);
      if (loadedItem) {
        setItem(loadedItem);
        setValues(valuesFromItem(loadedItem));
      } else {
        setItem(null);
        setValues(EMPTY_VALUES);
      }
      setImageDraft(null);
      setRemoveImage(false);
    } catch (error) {
      triggerHaptic();
      setSaveError(getRequestMessage(error, "Unable to load inventory item editor."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialItem, itemId]);

  useEffect(() => {
    void loadEditorData();
  }, [loadEditorData]);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.72,
      });
      if (result.canceled || !result.assets[0]) {
        return;
      }
      setImageDraft(imageDraftFromAsset(result.assets[0]));
      setRemoveImage(false);
      setSaveError(null);
    } catch (error) {
      triggerHaptic();
      setSaveError(getRequestMessage(error, "Unable to pick image."));
    }
  }, []);

  const toggleCategory = useCallback((categoryId: UUID) => {
    setValues((current) => {
      const next = new Set(current.categoryIds);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return { ...current, categoryIds: next };
    });
  }, []);

  const removeOrUndoImage = useCallback(() => {
    if (imageDraft) {
      setImageDraft(null);
      setRemoveImage(false);
      return;
    }
    setRemoveImage((current) => !current);
  }, [imageDraft]);

  const saveItem = useCallback(async () => {
    if (savingRef.current) {
      return;
    }
    if (!values.name.trim() || !values.tamilName.trim()) {
      triggerHaptic();
      setSaveError("Enter both English and Tamil names.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = buildInventoryPayload(values);
      const savedItem = effectiveItemId
        ? await updateInventoryItemMetadata(effectiveItemId, payload)
        : await createInventoryItemMetadata(payload);
      try {
        if (imageDraft) {
          await replaceInventoryItemImageFile(savedItem.id, imageDraft);
        } else if (removeImage) {
          await deleteInventoryItemImage(savedItem.id);
        }
      } catch (imageError) {
        triggerHaptic();
        setItem(savedItem);
        setValues(valuesFromItem(savedItem));
        setImageDraft(null);
        setRemoveImage(false);
        setSaveError(
          `Inventory item details were saved, but the image was not updated. ${getRequestMessage(
            imageError,
            "Try picking the image again.",
          )}`,
        );
        return;
      }
      navigation.goBack();
    } catch (error) {
      triggerHaptic();
      if (error instanceof Error && error.name === "UploadFileUnavailableError") {
        setSaveError(error.message);
      } else {
        setSaveError(getRequestMessage(error, "Unable to save inventory item."));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [effectiveItemId, imageDraft, navigation, removeImage, values]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <View style={[styles.topBar, { borderBottomColor: palette.border, paddingTop: Math.max(insets.top - 8, 0) }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>
            {isEdit ? "Edit inventory item" : "Add inventory item"}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>Image, names, unit, and categories</Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing}
          onRefresh={() => loadEditorData(true)}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadEditorData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
        }
        contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
      >
        {saveError ? (
          <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
            <Text style={[styles.errorText, { color: palette.danger }]}>{saveError}</Text>
          </View>
        ) : null}
        {loading ? (
          <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading item...</Text>
        ) : (
          <>
            <View style={[styles.imagePanel, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
              {currentImageUri ? (
                <Image source={{ uri: currentImageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <MaterialCommunityIcons name="image-plus" size={30} color={palette.textMuted} />
              )}
            </View>
            <View style={styles.row}>
              <ActionButton label="Pick image" icon="image-edit-outline" palette={palette} onPress={() => void pickImage()} />
              {canRemoveImage ? (
                <ActionButton
                  label={removeImage ? "Undo" : "Remove"}
                  icon={removeImage ? "undo" : "image-remove-outline"}
                  palette={palette}
                  onPress={removeOrUndoImage}
                />
              ) : null}
            </View>

            <EditorField
              label="English name"
              value={values.name}
              onChangeText={(name) => setValues((current) => ({ ...current, name }))}
              palette={palette}
            />
            <EditorField
              label="Tamil name"
              value={values.tamilName}
              onChangeText={(tamilName) => setValues((current) => ({ ...current, tamilName }))}
              palette={palette}
            />
            <View style={styles.row}>
              <ActionButton
                label="Weight"
                icon="scale-balance"
                palette={palette}
                active={values.unitType === UnitType.WEIGHT}
                onPress={() => setValues((current) => ({ ...current, unitType: UnitType.WEIGHT, baseUnit: BaseUnit.KG }))}
              />
              <ActionButton
                label="Count"
                icon="counter"
                palette={palette}
                active={values.unitType === UnitType.COUNT}
                onPress={() => setValues((current) => ({ ...current, unitType: UnitType.COUNT, baseUnit: BaseUnit.UNIT }))}
              />
            </View>

            <View style={styles.categoryChips}>
              {categories.map((category) => {
                const active = values.categoryIds.has(category.id);
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => toggleCategory(category.id)}
                    style={[
                      styles.categoryChip,
                      {
                        borderColor: active ? palette.inventory : palette.border,
                        backgroundColor: active ? palette.inventorySoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name={active ? "check-circle" : "shape-outline"} size={15} color={active ? palette.inventory : palette.textMuted} />
                    <Text style={[styles.chipText, { color: active ? palette.inventoryStrong : palette.textPrimary }]}>{category.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setValues((current) => ({ ...current, isActive: !current.isActive }))}
              style={[styles.toggleRow, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
            >
              <MaterialCommunityIcons name={values.isActive ? "toggle-switch" : "toggle-switch-off-outline"} size={28} color={values.isActive ? palette.inventory : palette.textMuted} />
              <Text style={[styles.itemName, { color: palette.textPrimary }]}>{values.isActive ? "Active" : "Inactive"}</Text>
            </Pressable>

            <View style={styles.row}>
              <ActionButton label="Cancel" icon="close-circle-outline" palette={palette} onPress={() => navigation.goBack()} />
              <ActionButton label={saving ? "Saving" : "Save"} icon="content-save-outline" palette={palette} active loading={saving} onPress={() => void saveItem()} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  active = false,
  loading = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  active?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const fg = active ? palette.onPrimary : palette.textPrimary;
  const bg = active ? palette.inventory : palette.card;
  const border = active ? palette.inventory : palette.border;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={[styles.actionButton, { borderColor: border, backgroundColor: bg, opacity: loading ? 0.65 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={fg} />
      <Text numberOfLines={1} style={[styles.actionText, { color: fg }]}>{loading ? "..." : label}</Text>
    </Pressable>
  );
}

function EditorField({
  label,
  value,
  keyboardType,
  onChangeText,
  palette,
}: {
  label: string;
  value: string;
  keyboardType?: "default" | "number-pad";
  onChangeText: (value: string) => void;
  palette: ThemePalette;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={label}
        placeholderTextColor={palette.textMuted}
        style={[styles.fieldInput, { borderColor: palette.border, backgroundColor: palette.surfaceMuted, color: palette.textPrimary }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "900", letterSpacing: 0 },
  subtitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemName: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  actionButton: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  actionText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontWeight: "700" },
  loadingText: { paddingVertical: 24, textAlign: "center", fontSize: 14, fontWeight: "800" },
  imagePanel: {
    width: 176,
    aspectRatio: 1,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  field: { gap: 7 },
  fieldLabel: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0 },
  fieldInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, fontWeight: "800" },
  categoryChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { minHeight: 36, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  chipText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  toggleRow: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
});
