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
  fetchCatalogueItemRows,
  fetchInventoryCategories,
  fetchInventoryItem,
  replaceInventoryItemImageFile,
  updateInventoryItemMetadata,
  type InventoryItemMetadataPayload,
  type ItemImageUploadFile,
} from "@/api/admin";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import {
  BaseUnit,
  UnitType,
  type InventoryBillingItemMappingRead,
  type InventoryBillingItemMappingWrite,
  type InventoryCategoryRead,
  type InventoryItemRead,
  type ShopItemRead,
  type UUID,
} from "@/types/api";
import { authenticatedImageSource, getItemThumbnailUri, resolveEditorImageUri } from "@/utils/item-images";

import type { AdminInventoryItemEditorScreenProps } from "@/navigation/types";
import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import {
  AdminGlobalImageTemplatePickerModal,
  chooseImageSourceAlert,
  useGlobalImageTemplatePicker,
} from "./components/admin-global-image-template-picker";
import { useAdminTheme } from "./use-admin-theme";

type ImageDraft = ItemImageUploadFile;
const ITEM_MAPPING_KEY = "__item__";

type InventoryEditorValues = {
  name: string;
  tamilName: string;
  unitType: UnitType;
  baseUnit: BaseUnit;
  sortOrder: string;
  isActive: boolean;
  billingMappingIds: Record<string, UUID | null>;
  categoryIds: Set<UUID>;
};

const EMPTY_VALUES: InventoryEditorValues = {
  name: "",
  tamilName: "",
  unitType: UnitType.WEIGHT,
  baseUnit: BaseUnit.KG,
  sortOrder: "0",
  isActive: true,
  billingMappingIds: {},
  categoryIds: new Set(),
};

function valuesFromItem(item: InventoryItemRead): InventoryEditorValues {
  const billingMappingIds: Record<string, UUID | null> = {};
  for (const mapping of item.billing_items ?? []) {
    billingMappingIds[mapping.inventory_category_id ?? ITEM_MAPPING_KEY] = mapping.billing_item_id;
  }
  if (item.billing_item_id && !billingMappingIds[ITEM_MAPPING_KEY]) {
    billingMappingIds[ITEM_MAPPING_KEY] = item.billing_item_id;
  }
  return {
    name: item.name,
    tamilName: item.tamil_name,
    unitType: item.unit_type,
    baseUnit: item.base_unit,
    sortOrder: String(item.sort_order ?? 0),
    isActive: item.is_active,
    billingMappingIds,
    categoryIds: new Set(item.category_ids),
  };
}

function buildInventoryPayload(values: InventoryEditorValues): InventoryItemMetadataPayload {
  const categoryIds = [...values.categoryIds];
  const billingMappings = categoryIds.reduce<InventoryBillingItemMappingWrite[]>((mappings, categoryId) => {
    const billingItemId = values.billingMappingIds[categoryId];
    if (billingItemId) {
      mappings.push({ inventory_category_id: categoryId, billing_item_id: billingItemId });
    }
    return mappings;
  }, []);
  const itemBillingItemId = categoryIds.length === 0 ? values.billingMappingIds[ITEM_MAPPING_KEY] ?? null : null;
  return {
    name: values.name.trim(),
    tamil_name: values.tamilName.trim(),
    unit_type: values.unitType,
    base_unit: values.baseUnit,
    sort_order: Number(values.sortOrder.trim() || 0),
    is_active: values.isActive,
    billing_item_id: itemBillingItemId,
    billing_item_ids: itemBillingItemId ? [itemBillingItemId] : [],
    billing_mappings: billingMappings,
    category_ids: categoryIds,
  };
}

async function fetchAllActiveCatalogueItems() {
  const items: ShopItemRead[] = [];
  let cursorSortOrder: number | null | undefined = null;
  let cursorName: string | null | undefined = null;
  let cursorId: UUID | null | undefined = null;
  do {
    const page = await fetchCatalogueItemRows({
      active: true,
      limit: 100,
      cursor_sort_order: cursorSortOrder,
      cursor_name: cursorName,
      cursor_id: cursorId,
    });
    items.push(...page.items);
    cursorSortOrder = page.next_cursor_sort_order;
    cursorName = page.next_cursor_name;
    cursorId = page.next_cursor_id;
    if (!page.has_more) {
      break;
    }
  } while (cursorName && cursorId);
  return items;
}

function imageDraftFromAsset(asset: ImagePicker.ImagePickerAsset): ImageDraft {
  const contentType = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const suffix = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const name = (asset.fileName?.trim() || `inventory-${Date.now()}${suffix}`).replace(/[^a-zA-Z0-9._-]/g, "-");
  return { uri: asset.uri, name, type: contentType };
}

function getRequestMessage(error: unknown, fallback: string) {
  return formatApiErrorMessage(error, fallback);
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
  const [billingItems, setBillingItems] = useState<ShopItemRead[]>([]);
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
  const [openMappingKey, setOpenMappingKey] = useState<string | null>(null);
  const {
    imageTemplates,
    imageTemplatesLoading,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    templatePreviewUri,
    templatePickerOpen,
    setTemplatePickerOpen,
    openTemplatePicker,
  } = useGlobalImageTemplatePicker({
    initialTemplateId: initialItem?.global_image_template_id ?? null,
  });

  const currentImageUri = resolveEditorImageUri({
    imageDraftUri: imageDraft?.uri,
    removeImageRequested: removeImage,
    selectedTemplateId,
    templatePreviewUri,
    storedImageUri: item ? getItemThumbnailUri(item) : "",
  });
  const canRemoveImage = Boolean(
    imageDraft || item?.image_path || item?.image_thumb_path || selectedTemplateId,
  );
  const effectiveItemId = itemId ?? item?.id ?? null;
  const isEdit = Boolean(effectiveItemId);
  const matchingBillingItems = useMemo(
    () => billingItems.filter((billingItem) => billingItem.base_unit === values.baseUnit),
    [billingItems, values.baseUnit],
  );
  const selectedCategories = useMemo(
    () => categories.filter((category) => values.categoryIds.has(category.id)),
    [categories, values.categoryIds],
  );
  const existingMappedItemsByKey = useMemo(() => {
    const mappedItems = new Map<string, InventoryBillingItemMappingRead>();
    for (const mappedItem of item?.billing_items ?? []) {
      mappedItems.set(mappedItem.inventory_category_id ?? ITEM_MAPPING_KEY, mappedItem);
    }
    return mappedItems;
  }, [item]);
  const loadEditorData = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setSaveError(null);
    try {
      const [nextCategories, nextBillingItems, loadedItem] = await Promise.all([
        fetchInventoryCategories(),
        fetchAllActiveCatalogueItems(),
        itemId && !initialItem ? fetchInventoryItem(itemId) : Promise.resolve(initialItem),
      ]);
      setCategories(nextCategories);
      setBillingItems(nextBillingItems);
      if (loadedItem) {
        setItem(loadedItem);
        setValues(valuesFromItem(loadedItem));
        setSelectedTemplateId(loadedItem.global_image_template_id ?? null);
      } else {
        setItem(null);
        setValues(EMPTY_VALUES);
        setSelectedTemplateId(null);
      }
      setOpenMappingKey(null);
      setImageDraft(null);
      setRemoveImage(false);
    } catch (error) {
      triggerHaptic();
      setSaveError(getRequestMessage(error, "Unable to load inventory item editor."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialItem, itemId, setSelectedTemplateId]);

  useEffect(() => {
    void loadEditorData();
  }, [loadEditorData]);

  const pickImageFromDevice = useCallback(async () => {
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

  const chooseImageSource = useCallback(() => {
    chooseImageSourceAlert({
      onChooseTemplate: () => void openTemplatePicker(),
      onUploadFromDevice: () => void pickImageFromDevice(),
    });
  }, [openTemplatePicker, pickImageFromDevice]);

  const toggleCategory = useCallback((categoryId: UUID) => {
    setValues((current) => {
      const next = new Set(current.categoryIds);
      const billingMappingIds = { ...current.billingMappingIds };
      if (next.has(categoryId)) {
        next.delete(categoryId);
        delete billingMappingIds[categoryId];
      } else {
        next.add(categoryId);
      }
      return { ...current, billingMappingIds, categoryIds: next };
    });
  }, []);

  const setBillingMapping = useCallback((mappingKey: string, billingItemId: UUID) => {
    setValues((current) => {
      return {
        ...current,
        billingMappingIds: { ...current.billingMappingIds, [mappingKey]: billingItemId },
      };
    });
  }, []);

  const clearBillingMapping = useCallback((mappingKey: string) => {
    setValues((current) => {
      const billingMappingIds = { ...current.billingMappingIds };
      delete billingMappingIds[mappingKey];
      return { ...current, billingMappingIds };
    });
  }, []);

  const activeMappingKeys = useMemo(
    () => selectedCategories.length > 0 ? selectedCategories.map((category) => category.id) : [ITEM_MAPPING_KEY],
    [selectedCategories],
  );

  const getBillingItemIdsMappedElsewhere = useCallback((mappingKey: string) => {
    const selectedElsewhere = new Set<UUID>();
    for (const activeKey of activeMappingKeys) {
      const mappedBillingItemId = values.billingMappingIds[activeKey];
      if (activeKey !== mappingKey && mappedBillingItemId) {
        selectedElsewhere.add(mappedBillingItemId);
      }
    }
    return selectedElsewhere;
  }, [activeMappingKeys, values.billingMappingIds]);

  const removeOrUndoImage = useCallback(() => {
    if (imageDraft) {
      setImageDraft(null);
      setRemoveImage(false);
      return;
    }
    if (removeImage) {
      setRemoveImage(false);
      return;
    }
    setRemoveImage(true);
    setSelectedTemplateId(null);
  }, [imageDraft, removeImage, setSelectedTemplateId]);

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
      const payload: InventoryItemMetadataPayload = {
        ...buildInventoryPayload(values),
      };
      const baselineTemplateId = item?.global_image_template_id ?? null;
      const hasTemplateChange = selectedTemplateId !== baselineTemplateId;
      if (!imageDraft) {
        if (removeImage) {
          payload.use_global_image_template = true;
          payload.global_image_template_id = null;
        } else if (isEdit && hasTemplateChange) {
          payload.use_global_image_template = true;
          payload.global_image_template_id = selectedTemplateId;
        } else if (!isEdit && selectedTemplateId) {
          payload.global_image_template_id = selectedTemplateId;
        }
      }
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
  }, [effectiveItemId, imageDraft, isEdit, item?.global_image_template_id, navigation, removeImage, selectedTemplateId, setSelectedTemplateId, values]);

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
          <Text style={[styles.title, { color: palette.onShell }]}>
            {isEdit ? "Edit inventory item" : "Add inventory item"}
          </Text>
          <Text style={[styles.subtitle, { color: palette.onShellMuted }]}>Image, names, unit, and categories</Text>
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
                <Image source={authenticatedImageSource(currentImageUri)} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <MaterialCommunityIcons name="image-plus" size={30} color={palette.textMuted} />
              )}
            </View>
            <View style={styles.row}>
              <ActionButton label="Pick image" icon="image-edit-outline" palette={palette} tone="info" onPress={chooseImageSource} />
              {canRemoveImage ? (
                <ActionButton
                  label={removeImage ? "Undo" : "Remove"}
                  icon={removeImage ? "undo" : "image-remove-outline"}
                  palette={palette}
                  tone={removeImage ? "warning" : "danger"}
                  onPress={removeOrUndoImage}
                />
              ) : null}
            </View>
            {selectedTemplate ? (
              <Text style={[styles.templateHint, { color: palette.textMuted }]}>
                Shared template: {selectedTemplate.name}
              </Text>
            ) : null}

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
                onPress={() =>
                  setValues((current) => ({
                    ...current,
                    unitType: UnitType.WEIGHT,
                    baseUnit: BaseUnit.KG,
                    billingMappingIds:
                      current.baseUnit === BaseUnit.KG ? current.billingMappingIds : {},
                  }))
                }
              />
              <ActionButton
                label="Count"
                icon="counter"
                palette={palette}
                active={values.unitType === UnitType.COUNT}
                onPress={() =>
                  setValues((current) => ({
                    ...current,
                    unitType: UnitType.COUNT,
                    baseUnit: BaseUnit.UNIT,
                    billingMappingIds:
                      current.baseUnit === BaseUnit.UNIT ? current.billingMappingIds : {},
                  }))
                }
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

            {selectedCategories.length > 0 ? (
              <View style={styles.mappingList}>
                {selectedCategories.map((category) => (
                  <InventoryBillingMappingDropdown
                    key={category.id}
                    label={category.name}
                    existingMappedItem={existingMappedItemsByKey.get(category.id)}
                    open={openMappingKey === category.id}
                    options={matchingBillingItems}
                    palette={palette}
                    selectedId={values.billingMappingIds[category.id] ?? null}
                    selectedElsewhereIds={getBillingItemIdsMappedElsewhere(category.id)}
                    unit={values.baseUnit}
                    onClear={() => clearBillingMapping(category.id)}
                    onToggle={() => {
                      setOpenMappingKey((current) => current === category.id ? null : category.id);
                    }}
                    onSelect={(billingItemId) => setBillingMapping(category.id, billingItemId)}
                  />
                ))}
              </View>
            ) : (
              <InventoryBillingMappingDropdown
                label="Inventory item"
                existingMappedItem={existingMappedItemsByKey.get(ITEM_MAPPING_KEY)}
                open={openMappingKey === ITEM_MAPPING_KEY}
                options={matchingBillingItems}
                palette={palette}
                selectedId={values.billingMappingIds[ITEM_MAPPING_KEY] ?? null}
                selectedElsewhereIds={getBillingItemIdsMappedElsewhere(ITEM_MAPPING_KEY)}
                unit={values.baseUnit}
                onClear={() => clearBillingMapping(ITEM_MAPPING_KEY)}
                onToggle={() => {
                  setOpenMappingKey((current) => current === ITEM_MAPPING_KEY ? null : ITEM_MAPPING_KEY);
                }}
                onSelect={(billingItemId) => setBillingMapping(ITEM_MAPPING_KEY, billingItemId)}
              />
            )}
            <Pressable
              onPress={() => setValues((current) => ({ ...current, isActive: !current.isActive }))}
              style={[styles.toggleRow, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
            >
              <MaterialCommunityIcons name={values.isActive ? "toggle-switch" : "toggle-switch-off-outline"} size={28} color={values.isActive ? palette.inventory : palette.textMuted} />
              <Text style={[styles.itemName, { color: palette.textPrimary }]}>{values.isActive ? "Active" : "Inactive"}</Text>
            </Pressable>

            <View style={styles.row}>
              <ActionButton label="Cancel" icon="close-circle-outline" palette={palette} onPress={() => navigation.goBack()} />
              <ActionButton label={saving ? "Saving" : "Save"} icon="content-save-outline" palette={palette} tone="primary" active loading={saving} onPress={() => void saveItem()} />
            </View>
            {isEdit ? (
              <ActionButton
                label="Cannot delete - has billing history"
                icon="trash-can-outline"
                palette={palette}
                tone="danger"
                active={false}
                disabled={true}
                onPress={() => {}}
              />
            ) : null}
          </>
        )}
      </ScrollView>
      <AdminGlobalImageTemplatePickerModal
        visible={templatePickerOpen}
        palette={palette}
        templates={imageTemplates}
        loading={imageTemplatesLoading}
        selectedTemplateId={selectedTemplateId}
        accentColor={palette.inventory}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(templateId) => {
          setSelectedTemplateId(templateId);
          setImageDraft(null);
          setRemoveImage(false);
        }}
        onUploadFromDevice={() => void pickImageFromDevice()}
      />
    </SafeAreaView>
  );
}

function InventoryBillingMappingDropdown({
  label,
  existingMappedItem,
  open,
  options,
  palette,
  selectedId,
  selectedElsewhereIds,
  unit,
  onClear,
  onToggle,
  onSelect,
}: {
  label: string;
  existingMappedItem?: InventoryBillingItemMappingRead;
  open: boolean;
  options: ShopItemRead[];
  palette: ThemePalette;
  selectedId: UUID | null;
  selectedElsewhereIds: Set<UUID>;
  unit: BaseUnit;
  onClear: () => void;
  onToggle: () => void;
  onSelect: (billingItemId: UUID) => void;
}) {
  const optionIds = new Set(options.map((option) => option.id));
  const selectedOption = options.find((option) => option.id === selectedId);
  const inactiveSelectedItem =
    existingMappedItem && selectedId === existingMappedItem.billing_item_id && !optionIds.has(existingMappedItem.billing_item_id)
      ? existingMappedItem
      : null;
  const selectedLabel = selectedOption?.name ?? inactiveSelectedItem?.billing_item_name ?? "No billing item";
  return (
    <View style={styles.dropdownWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={[
          styles.dropdownSelect,
          {
            borderColor: open ? palette.inventory : palette.border,
            backgroundColor: palette.surfaceMuted,
          },
        ]}
      >
        <View style={[styles.dropdownIcon, { backgroundColor: palette.inventorySoft }]}>
          <MaterialCommunityIcons name="link-variant" size={18} color={palette.inventory} />
        </View>
        <View style={styles.dropdownText}>
          <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>{label}</Text>
          <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
            {selectedLabel}
          </Text>
        </View>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={20} color={palette.textMuted} />
      </Pressable>
      {open ? (
        <View style={[styles.dropdownMenu, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <Pressable
            onPress={onClear}
            style={[
              styles.dropdownOption,
              {
                borderColor: selectedId === null ? palette.inventory : palette.border,
                backgroundColor: selectedId === null ? palette.inventorySoft : palette.surfaceMuted,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={selectedId === null ? "check-circle" : "close-circle-outline"}
              size={16}
              color={selectedId === null ? palette.inventory : palette.textMuted}
            />
            <Text style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>No mapped billing item</Text>
          </Pressable>
          {inactiveSelectedItem ? (
            <Pressable
              onPress={() => onSelect(inactiveSelectedItem.billing_item_id)}
              style={[
                styles.dropdownOption,
                {
                  borderColor: palette.inventory,
                  backgroundColor: palette.inventorySoft,
                },
              ]}
            >
              <MaterialCommunityIcons name="check-circle" size={16} color={palette.inventory} />
              <View style={styles.dropdownOptionTextWrap}>
                <Text numberOfLines={1} style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>
                  {inactiveSelectedItem.billing_item_name}
                </Text>
                <Text numberOfLines={1} style={[styles.dropdownOptionSubtext, { color: palette.textMuted }]}>
                  Existing mapping
                </Text>
              </View>
            </Pressable>
          ) : null}
          {options.length === 0 ? (
            <Text style={[styles.dropdownEmpty, { color: palette.textMuted }]}>
              No active {unit} billing items found.
            </Text>
          ) : (
            options.map((billingItem) => {
              const active = selectedId === billingItem.id;
              const disabled = !active && selectedElsewhereIds.has(billingItem.id);
              return (
                <Pressable
                  key={billingItem.id}
                  disabled={disabled}
                  onPress={() => onSelect(billingItem.id)}
                  style={[
                    styles.dropdownOption,
                    {
                      borderColor: active ? palette.inventory : palette.border,
                      backgroundColor: active ? palette.inventorySoft : palette.surfaceMuted,
                      opacity: disabled ? 0.48 : 1,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={active ? "check-circle" : disabled ? "lock-outline" : "circle-outline"}
                    size={16}
                    color={active ? palette.inventory : palette.textMuted}
                  />
                  <View style={styles.dropdownOptionTextWrap}>
                    <Text numberOfLines={1} style={[styles.dropdownOptionText, { color: palette.textPrimary }]}>
                      {billingItem.name}
                    </Text>
                    {billingItem.tamil_name ? (
                      <Text numberOfLines={1} style={[styles.dropdownOptionSubtext, { color: palette.textMuted }]}>
                        {disabled ? "Already mapped" : billingItem.tamil_name}
                      </Text>
                    ) : disabled ? (
                      <Text numberOfLines={1} style={[styles.dropdownOptionSubtext, { color: palette.textMuted }]}>
                        Already mapped
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  tone,
  active = false,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  let fg = active ? palette.onPrimary : palette.textPrimary;
  let bg = active ? palette.inventory : palette.card;
  let border = active ? palette.inventory : palette.border;

  if (tone === "danger") {
    fg = palette.danger;
    bg = active ? palette.dangerSoft : palette.card;
    border = palette.danger;
  } else if (tone === "success") {
    fg = active ? palette.onPrimary : palette.success;
    bg = active ? palette.success : palette.successSoft;
    border = palette.success;
  } else if (tone === "warning") {
    fg = active ? palette.onCash : palette.warning;
    bg = active ? palette.cash : palette.warningSoft;
    border = palette.warning;
  } else if (tone === "info") {
    fg = active ? palette.onPrimary : palette.primaryStrong;
    bg = active ? palette.primary : palette.primarySoft;
    border = palette.primaryStrong;
  } else if (tone === "primary") {
    fg = active ? palette.onPrimary : palette.primaryStrong;
    bg = active ? palette.primary : palette.primarySoft;
    border = palette.primary;
  }

  const isActuallyDisabled = loading || disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isActuallyDisabled }}
      disabled={isActuallyDisabled}
      onPress={onPress}
      style={[styles.actionButton, { borderColor: border, backgroundColor: bg, opacity: isActuallyDisabled ? 0.65 : 1 }]}
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
  templateHint: { fontSize: 12, fontWeight: "600" },
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
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  field: { gap: 7 },
  fieldLabel: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0 },
  fieldInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, fontWeight: "800" },
  dropdownWrap: { gap: 8 },
  dropdownSelect: { minHeight: 58, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 12 },
  dropdownIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  dropdownText: { flex: 1, minWidth: 0, gap: 2 },
  dropdownLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  dropdownValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  dropdownMenu: { borderWidth: 1, borderRadius: 12, padding: 6, gap: 4 },
  dropdownOption: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 9 },
  dropdownOptionTextWrap: { flex: 1, minWidth: 0, gap: 2 },
  dropdownOptionText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "900", letterSpacing: 0 },
  dropdownOptionSubtext: { fontSize: 11, fontWeight: "700", letterSpacing: 0 },
  dropdownEmpty: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  mappingList: { gap: 12 },
  categoryChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { minHeight: 36, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  chipText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  toggleRow: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
});
