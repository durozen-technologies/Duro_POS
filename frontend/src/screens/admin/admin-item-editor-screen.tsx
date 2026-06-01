import { MaterialCommunityIcons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Button as TButton, Input, Spinner, XStack, YStack } from "tamagui";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import {
  createItem,
  createItemCategory,
  createItemWithImageFile,
  createShopItem,
  createShopItemWithImageFile,
  deleteItemImage,
  deleteItemCategory,
  fetchCatalogueItem,
  fetchItemCategories,
  fetchShopItem,
  replaceItemImageFile,
  updateItem,
  updateItemWithImageFile,
  updateItemMetadata,
  updateShopItem,
  updateShopItemAllocation,
  updateShopItemWithImageFile,
  updateShopItemMetadata,
} from "@/api/admin";
import { isApiRequestCanceled, resolveApiUrl, toApiError } from "@/api/client";
import type { ItemCategoryRead, ItemMetadataUpdate, ShopItemRead, UUID } from "@/types/api";
import type { AdminItemEditorScreenProps } from "@/navigation/types";

import { getAdminPalette, type ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import {
  AdminItemEditorMode,
  AdminItemWorkspace,
} from "./admin-items-model";

type ExpoImagePickerModule = typeof import("expo-image-picker");
type ImageDraft = {
  uri: string;
  name: string;
  type: string;
};
type PickedImageAsset = {
  uri: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};
type ReactNativeFormDataFile = {
  uri: string;
  name: string;
  type: string;
};

const MAX_ITEM_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ITEM_IMAGE_UPLOAD_DRAFT_DIR = "item-image-uploads";
const ATTRIBUTE_VALUE_TYPES = ["text", "number", "boolean", "null"] as const;
type AttributeValueType = typeof ATTRIBUTE_VALUE_TYPES[number];

const attributeSchema = z
  .object({
    key: z.string().trim().min(1, "Key is required.").max(48, "Keep keys under 48 characters."),
    value: z.string().max(160, "Keep values under 160 characters."),
    valueType: z.enum(ATTRIBUTE_VALUE_TYPES),
  })
  .superRefine((row, context) => {
    if (row.valueType === "number" && !Number.isFinite(Number(row.value.trim()))) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a valid number.",
      });
    }
  });

const editorSchema = z
  .object({
    name: z.string().trim().min(2, "Enter at least 2 characters.").max(120, "Name is too long."),
    tamilName: z.string().trim().min(1, "Tamil name is required.").max(120, "Tamil name is too long."),
    unitType: z.enum(["weight", "count"]),
    baseUnit: z.enum(["kg", "unit"]),
    isActive: z.boolean(),
    sortOrder: z.string().trim().regex(/^-?\d+$/, "Use a whole number."),
    categoryId: z.string(),
    category: z.string().max(80, "Category is too long."),
    attributes: z.array(attributeSchema),
  })
  .superRefine((values, context) => {
    if (values.unitType === "weight" && values.baseUnit !== "kg") {
      context.addIssue({
        code: "custom",
        path: ["baseUnit"],
        message: "Weight items must use KG.",
      });
    }
    if (values.unitType === "count" && values.baseUnit !== "unit") {
      context.addIssue({
        code: "custom",
        path: ["baseUnit"],
        message: "Count items must use Unit.",
      });
    }
    const keys = new Map<string, number>();
    values.attributes.forEach((row, index) => {
      const key = row.key.trim();
      if (!key) {
        return;
      }
      const existingIndex = keys.get(key);
      if (existingIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["attributes", index, "key"],
          message: `Duplicate key, already used in row ${existingIndex + 1}.`,
        });
      } else {
        keys.set(key, index);
      }
    });
  });

type EditorValues = z.infer<typeof editorSchema>;

const EMPTY_EDITOR: EditorValues = {
  name: "",
  tamilName: "",
  unitType: "weight",
  baseUnit: "kg",
  isActive: true,
  sortOrder: "0",
  categoryId: "",
  category: "",
  attributes: [],
};

async function loadImagePickerModule(): Promise<ExpoImagePickerModule | null> {
  try {
    const imagePicker = await import("expo-image-picker");
    if (!imagePicker.launchImageLibraryAsync) {
      return null;
    }
    return imagePicker;
  } catch (error) {
    console.warn("expo-image-picker is unavailable in the current native build.", error);
    return null;
  }
}

function appendReactNativeFile(formData: FormData, fieldName: string, file: ImageDraft) {
  const uploadFile: ReactNativeFormDataFile = {
    uri: file.uri,
    name: file.name,
    type: file.type,
  };
  formData.append(fieldName, uploadFile as unknown as Blob);
}

function extensionForImageType(contentType: string) {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "image/webp") {
    return ".webp";
  }
  return ".jpg";
}

function normalizedImageFilename(asset: PickedImageAsset, contentType: string) {
  const fallbackName = `item-${Date.now()}${extensionForImageType(contentType)}`;
  const candidate = asset.fileName?.trim() || fallbackName;
  const sanitized = candidate.replace(/[^a-zA-Z0-9._-]/g, "-");
  return /\.[a-zA-Z0-9]+$/.test(sanitized)
    ? sanitized
    : `${sanitized}${extensionForImageType(contentType)}`;
}

function readableBytes(byteCount: number) {
  return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

async function ensureImageUploadDraftDirectory() {
  const parentDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!parentDirectory) {
    throw new Error("Image upload storage is unavailable on this device.");
  }

  const uploadDirectory = `${parentDirectory}${ITEM_IMAGE_UPLOAD_DRAFT_DIR}`;
  try {
    await FileSystem.makeDirectoryAsync(uploadDirectory, { intermediates: true });
  } catch (error) {
    const directoryInfo = await FileSystem.getInfoAsync(uploadDirectory);
    if (!directoryInfo.exists || !directoryInfo.isDirectory) {
      throw error;
    }
  }
  return uploadDirectory;
}

async function getLocalFileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error("Selected image file is no longer available. Pick it again and save.");
  }
  return typeof info.size === "number" ? info.size : null;
}

async function copyImageToUploadDraftDirectory(sourceUri: string, name: string) {
  const uploadDirectory = await ensureImageUploadDraftDirectory();
  const cachedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
  const cachedUri = `${uploadDirectory.replace(/\/$/, "")}/${cachedName}`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: cachedUri });
  } catch (error) {
    throw new Error(
      "Selected image could not be prepared for upload. Pick the image again and save.",
      { cause: error },
    );
  }
  return cachedUri;
}

async function deleteImageDraftFile(draft: ImageDraft | null) {
  if (!draft?.uri) {
    return;
  }
  try {
    await FileSystem.deleteAsync(draft.uri, { idempotent: true });
  } catch {
    // The OS may already have cleaned it up; nothing else to do.
  }
}

async function prepareImageDraftForUpload(asset: PickedImageAsset): Promise<ImageDraft> {
  const contentType = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const name = normalizedImageFilename(asset, contentType);
  const uri = asset.uri;

  if (!uri) {
    throw new Error("Selected image has no readable file URI. Pick another image.");
  }

  if (typeof asset.fileSize === "number" && asset.fileSize > MAX_ITEM_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `Selected image is ${readableBytes(asset.fileSize)}. Choose an image under ${readableBytes(MAX_ITEM_IMAGE_UPLOAD_BYTES)}.`,
    );
  }

  const cachedUri = await copyImageToUploadDraftDirectory(uri, name);
  const preparedSize = await getLocalFileSize(cachedUri);
  if (preparedSize !== null && preparedSize > MAX_ITEM_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `Selected image is ${readableBytes(preparedSize)}. Choose an image under ${readableBytes(MAX_ITEM_IMAGE_UPLOAD_BYTES)}.`,
    );
  }

  return { uri: cachedUri, name, type: contentType };
}

function attributesFromObject(attributes: ShopItemRead["custom_attributes"]): EditorValues["attributes"] {
  return Object.entries(attributes ?? {}).map(([key, value]) => {
    const valueType: AttributeValueType =
      value == null ? "null" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
    return {
      key,
      value: value == null ? "" : String(value),
      valueType,
    };
  });
}

function attributesToObject(rows: EditorValues["attributes"]) {
  const output: Record<string, string | number | boolean | null> = {};
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      throw new Error("Attribute key is required.");
    }
    if (keys.has(key)) {
      throw new Error(`Duplicate attribute key: ${key}`);
    }
    keys.add(key);
    if (row.valueType === "number") {
      const value = Number(row.value.trim());
      if (!Number.isFinite(value)) {
        throw new Error(`${key} must be a valid number.`);
      }
      output[key] = value;
    } else if (row.valueType === "boolean") {
      output[key] = row.value === "true";
    } else if (row.valueType === "null") {
      output[key] = null;
    } else {
      output[key] = row.value;
    }
  }
  return output;
}

function valuesFromItem(item: ShopItemRead): EditorValues {
  return {
    name: item.name,
    tamilName: item.tamil_name ?? "",
    unitType: item.unit_type,
    baseUnit: item.base_unit,
    isActive: item.is_active,
    sortOrder: String(item.sort_order ?? 0),
    categoryId: item.category_id ?? "",
    category: item.category ?? "",
    attributes: attributesFromObject(item.custom_attributes),
  };
}

function buildFormFields(
  values: EditorValues,
  customAttributes: Record<string, string | number | boolean | null>,
  removeImage: boolean,
) {
  const fields: Record<string, string> = {
    name: values.name.trim(),
    tamil_name: values.tamilName.trim(),
    unit_type: values.unitType,
    base_unit: values.baseUnit,
    is_active: String(values.isActive),
    sort_order: values.sortOrder.trim() || "0",
    category: values.category.trim(),
    custom_attributes: JSON.stringify(customAttributes),
    remove_image: String(removeImage),
  };
  if (values.categoryId) {
    fields.category_id = values.categoryId;
  }
  return fields;
}

function buildFormData(values: EditorValues, imageDraft: ImageDraft | null, removeImage: boolean) {
  const formData = new FormData();
  Object.entries(buildFormFields(values, attributesToObject(values.attributes), removeImage && !imageDraft)).forEach(
    ([key, value]) => {
      formData.append(key, value);
    },
  );
  if (imageDraft) {
    appendReactNativeFile(formData, "image", imageDraft);
  }
  return formData;
}

function buildMetadataPayload(
  values: EditorValues,
  customAttributes: Record<string, string | number | boolean | null>,
): ItemMetadataUpdate {
  const categoryId = values.categoryId.trim();
  return {
    name: values.name.trim(),
    tamil_name: values.tamilName.trim(),
    unit_type: values.unitType,
    base_unit: values.baseUnit,
    is_active: values.isActive,
    sort_order: Number(values.sortOrder || 0),
    category_id: categoryId || null,
    category: categoryId ? values.category.trim() || null : null,
    custom_attributes: customAttributes,
  };
}

function nextAttributeType(current: AttributeValueType): AttributeValueType {
  const index = ATTRIBUTE_VALUE_TYPES.indexOf(current);
  return ATTRIBUTE_VALUE_TYPES[(index + 1) % ATTRIBUTE_VALUE_TYPES.length];
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  const apiError = toApiError(error);
  return apiError.message || fallback;
}

export function AdminItemEditorScreen({ navigation, route }: AdminItemEditorScreenProps) {
  const colorScheme = useColorScheme();
  const palette = useMemo(() => getAdminPalette(colorScheme), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { mode, workspace, itemId, shopId, initialItem } = route.params;
  const isCreate = mode === AdminItemEditorMode.Create;
  const isCustomize = mode === AdminItemEditorMode.Customize;
  const [item, setItem] = useState<ShopItemRead | null>(() => (isCreate ? null : initialItem ?? null));
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [categories, setCategories] = useState<ItemCategoryRead[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [loading, setLoading] = useState(!isCreate && !initialItem);
  const [saving, setSaving] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [storedImageFailed, setStoredImageFailed] = useState(false);
  const [itemReloadKey, setItemReloadKey] = useState(0);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<EditorValues>({
    defaultValues: isCreate || !initialItem ? EMPTY_EDITOR : valuesFromItem(initialItem),
    resolver: zodResolver(editorSchema),
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "attributes" });
  const unitType = watch("unitType");
  const isActive = watch("isActive");
  const watchedAttributes = watch("attributes");
  const selectedCategoryId = watch("categoryId");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = isDirty || Boolean(imageDraft) || removeImageRequested;
  }, [imageDraft, isDirty, removeImageRequested]);

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    setCategoriesLoading(true);
    try {
      const nextCategories = await fetchItemCategories({ signal });
      setCategories(nextCategories);
      setCategoryError(null);
    } catch (requestError) {
      if (isApiRequestCanceled(requestError)) {
        return;
      }
      setCategoryError(getRequestErrorMessage(requestError, "Unable to load categories."));
    } finally {
      if (!signal?.aborted) {
        setCategoriesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isCustomize) {
      setCategoryError(null);
      setCategoriesLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadCategories(controller.signal);
    return () => controller.abort();
  }, [isCustomize, loadCategories]);

  useEffect(() => {
    if (isCreate || !itemId) {
      setItem(null);
      reset(EMPTY_EDITOR);
      setImageDraft(null);
      setRemoveImageRequested(false);
      setLoading(false);
      setItemError(null);
      setImageError(null);
      setImageStatus(null);
      setStoredImageFailed(false);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    if (initialItem) {
      setItem(initialItem);
      reset(valuesFromItem(initialItem));
      setImageDraft(null);
      setRemoveImageRequested(false);
      setStoredImageFailed(false);
      setLoading(false);
    } else {
      setLoading(true);
    }
    if (!initialItem) {
      setItemError(null);
    }
    const request =
      workspace === AdminItemWorkspace.Catalogue || !shopId
        ? fetchCatalogueItem(itemId, { signal: controller.signal })
        : fetchShopItem(shopId, itemId, { signal: controller.signal });
    void request
      .then((loadedItem) => {
        if (!alive) {
          return;
        }
        setItem(loadedItem);
        if (!dirtyRef.current) {
          reset(valuesFromItem(loadedItem));
          setImageDraft(null);
          setRemoveImageRequested(false);
          setStoredImageFailed(false);
        }
        setItemError(null);
      })
      .catch((requestError) => {
        if (isApiRequestCanceled(requestError)) {
          return;
        }
        if (alive) {
          if (!initialItem) {
            setItemError(getRequestErrorMessage(requestError, "Unable to load item."));
          }
        }
      })
      .finally(() => {
        if (alive && !initialItem) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [initialItem, isCreate, itemId, itemReloadKey, reset, shopId, workspace]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (saving || (!isDirty && !imageDraft && !removeImageRequested)) {
        return;
      }
      event.preventDefault();
      Alert.alert("Discard item changes?", "Unsaved item changes will be lost.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [imageDraft, isDirty, navigation, removeImageRequested, saving]);

  const title = isCreate
    ? workspace === AdminItemWorkspace.Catalogue
      ? "Add catalogue item"
      : "Add shop item"
    : isCustomize
      ? "Customize shop item"
      : "Edit item";
  const storedImagePath = item?.image_path || item?.image_thumb_path || "";
  const hasStoredImage = Boolean(item?.image_path || item?.image_thumb_path);
  const storedImageUri = storedImagePath && !storedImageFailed ? resolveApiUrl(storedImagePath) : "";
  const currentImageUri = removeImageRequested
    ? ""
    : imageDraft?.uri ?? storedImageUri;
  const currentImageIsDraft = Boolean(imageDraft && !removeImageRequested);
  const canEditSharedFields = !isCustomize;
  const customizationBlocked = isCustomize && item !== null && !item.allocated;
  const hasImageChange = Boolean(imageDraft || removeImageRequested);
  const hasPendingChanges = isDirty || hasImageChange;
  const isImageOnlyChange =
    !isCreate &&
    !isCustomize &&
    Boolean(itemId) &&
    hasImageChange &&
    !isDirty;
  const saveDisabled = saving || customizationBlocked || (!isCreate && !hasPendingChanges) || (isCreate && !isValid);

  useEffect(() => {
    setStoredImageFailed(false);
    setImageError(null);
  }, [item?.image_path, item?.image_thumb_path]);

  const pickImage = useCallback(async () => {
    setImageError(null);
    setImageStatus("Opening image picker...");
    const imagePicker = await loadImagePickerModule();
    if (!imagePicker) {
      setImageStatus(null);
      setImageError(
        "Image picker is not available in this installed Android build. Reinstall the dev client so the native image picker module is included.",
      );
      return;
    }
    try {
      const result = await imagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.72,
      });
      if (result.canceled || !result.assets[0]) {
        setImageStatus(null);
        return;
      }
      const draft = await prepareImageDraftForUpload(result.assets[0]);
      setSaveError(null);
      setImageError(null);
      setImageStatus("Ready to upload when you save.");
      setRemoveImageRequested(false);
      setStoredImageFailed(false);
      void deleteImageDraftFile(imageDraft);
      setImageDraft(draft);
    } catch (error) {
      triggerHaptic();
      setImageStatus(null);
      setImageError(
        error instanceof Error && error.message
          ? error.message
          : "Unable to open the image picker on this device.",
      );
    }
  }, [imageDraft]);

  const removeImage = useCallback(() => {
    if (imageDraft) {
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      setImageError(null);
      setImageStatus(null);
      return;
    }
    if (removeImageRequested) {
      setRemoveImageRequested(false);
      setImageError(null);
      setImageStatus(null);
      return;
    }
    if (!itemId || !hasStoredImage) {
      setImageDraft(null);
      return;
    }
    Alert.alert("Remove item image", `Remove the stored image for ${item?.name ?? "this item"} when you save?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove on save",
        style: "destructive",
        onPress: () => {
          setSaveError(null);
          setImageError(null);
          setImageStatus("Stored image will be removed when you save.");
          setRemoveImageRequested(true);
        },
      },
    ]);
  }, [hasStoredImage, imageDraft, item?.name, itemId, removeImageRequested]);

  const addCategory = useCallback(async () => {
    const categoryName = categoryDraft.trim();
    if (!categoryName) {
      triggerHaptic();
      setCategoryError("Enter a category name.");
      return;
    }
    setCategoriesLoading(true);
    setCategoryError(null);
    try {
      const createdCategory = await createItemCategory({ name: categoryName });
      setCategories((current) => [...current, createdCategory].sort((left, right) => left.name.localeCompare(right.name)));
      setCategoryDraft("");
      setValue("categoryId", createdCategory.id, { shouldDirty: true, shouldValidate: true });
      setValue("category", createdCategory.name, { shouldDirty: true, shouldValidate: true });
    } catch (requestError) {
      triggerHaptic();
      setCategoryError(getRequestErrorMessage(requestError, "Unable to create category."));
    } finally {
      setCategoriesLoading(false);
    }
  }, [categoryDraft, setValue]);

  const removeCategory = useCallback(async (category: ItemCategoryRead) => {
    Alert.alert("Delete category", `Delete ${category.name}? Items using it will become uncategorized.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setCategoriesLoading(true);
            setCategoryError(null);
            try {
              await deleteItemCategory(category.id);
              setCategories((current) => current.filter((candidate) => candidate.id !== category.id));
              if (selectedCategoryId === category.id) {
                setValue("categoryId", "", { shouldDirty: true, shouldValidate: true });
                setValue("category", "", { shouldDirty: true, shouldValidate: true });
              }
            } catch (requestError) {
              triggerHaptic();
              setCategoryError(getRequestErrorMessage(requestError, "Unable to delete category."));
            } finally {
              setCategoriesLoading(false);
            }
          })();
        },
      },
    ]);
  }, [selectedCategoryId, setValue]);

  const saveImageOnlyChange = useCallback(async () => {
    if (!itemId || !hasImageChange || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setImageError(null);
    setImageStatus(imageDraft ? "Uploading replacement image..." : "Removing stored image...");
    try {
      if (imageDraft) {
        await replaceItemImageFile(itemId, imageDraft);
      } else {
        await deleteItemImage(itemId);
      }
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      setRemoveImageRequested(false);
      setStoredImageFailed(false);
      if (workspace === AdminItemWorkspace.Catalogue) {
        navigation.navigate("AdminItemsCatalogue");
      } else {
        navigation.navigate("AdminShopItems", { shopId });
      }
    } catch (requestError) {
      triggerHaptic();
      setImageError(getRequestErrorMessage(requestError, "Unable to save item image."));
    } finally {
      savingRef.current = false;
      setSaving(false);
      setImageStatus(null);
    }
  }, [hasImageChange, imageDraft, itemId, navigation, shopId, workspace]);

  const submit = handleSubmit(async (values) => {
    let customAttributes: Record<string, string | number | boolean | null>;
    try {
      customAttributes = attributesToObject(values.attributes);
    } catch (requestError) {
      triggerHaptic();
      setSaveError(requestError instanceof Error ? requestError.message : "Invalid custom attributes.");
      return;
    }
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setImageError(null);
    setImageStatus(hasImageChange ? "Saving item image..." : null);
    try {
      if (isCustomize) {
        if (!shopId || !itemId) {
          throw new Error("Shop and item are required for customization.");
        }
        if (customizationBlocked) {
          throw new Error("Allocate this item to the shop before customizing it.");
        }
        await updateShopItemAllocation(shopId, itemId, {
          display_name: values.name.trim(),
          tamil_name: values.tamilName.trim(),
          is_active: values.isActive,
          sort_order: Number(values.sortOrder || 0),
          custom_attributes: customAttributes,
        });
      } else if (isCreate) {
        const payload = buildFormFields(values, customAttributes, false);
        if (workspace === AdminItemWorkspace.Catalogue) {
          if (imageDraft) {
            await createItemWithImageFile(payload, imageDraft);
          } else {
            await createItem(buildFormData(values, null, false));
          }
        } else {
          if (!shopId) {
            throw new Error("Select a shop before creating a shop item.");
          }
          if (imageDraft) {
            await createShopItemWithImageFile(shopId, payload, imageDraft);
          } else {
            await createShopItem(shopId, buildFormData(values, null, false));
          }
        }
      } else {
        if (!itemId) {
          throw new Error("Item is required for editing.");
        }
        if (workspace === AdminItemWorkspace.Catalogue || !shopId) {
          if (hasImageChange && !isDirty) {
            if (imageDraft) {
              await replaceItemImageFile(itemId, imageDraft);
            } else {
              await deleteItemImage(itemId);
            }
          } else if (hasImageChange) {
            if (imageDraft) {
              await updateItemWithImageFile(
                itemId,
                buildFormFields(values, customAttributes, false),
                imageDraft,
              );
            } else {
              await updateItem(itemId, buildFormData(values, null, removeImageRequested));
            }
          } else {
            await updateItemMetadata(itemId, buildMetadataPayload(values, customAttributes));
          }
        } else {
          if (hasImageChange) {
            if (imageDraft) {
              await updateShopItemWithImageFile(
                shopId,
                itemId,
                buildFormFields(values, customAttributes, false),
                imageDraft,
              );
            } else {
              await updateShopItem(shopId, itemId, buildFormData(values, null, removeImageRequested));
            }
          } else {
            await updateShopItemMetadata(shopId, itemId, buildMetadataPayload(values, customAttributes));
          }
        }
      }
      reset(values);
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      setRemoveImageRequested(false);
      setStoredImageFailed(false);
      if (workspace === AdminItemWorkspace.Catalogue) {
        navigation.navigate("AdminItemsCatalogue");
      } else {
        navigation.navigate("AdminShopItems", { shopId });
      }
    } catch (requestError) {
      triggerHaptic();
      const message = getRequestErrorMessage(requestError, "Unable to save item.");
      if (hasImageChange) {
        setImageError(message);
      } else {
        setSaveError(message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      setImageStatus(null);
    }
  }, () => {
    savingRef.current = false;
    triggerHaptic();
    setSaveError("Fix the highlighted fields before saving.");
  });

  const saveItem = useCallback(() => {
    if (saveDisabled || savingRef.current) {
      return;
    }
    if (isImageOnlyChange) {
      void saveImageOnlyChange();
      return;
    }
    void submit();
  }, [isImageOnlyChange, saveDisabled, saveImageOnlyChange, submit]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <View style={[styles.topBar, { borderBottomColor: palette.border, paddingTop: Math.max(insets.top - 8, 0) }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.textPrimary }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.textMuted }]}>
            {isCustomize ? "Shop-only overrides" : "Names, units, image, and category"}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <Spinner color={palette.emerald} />
          <Text style={[styles.helper, { color: palette.textMuted }]}>Loading item...</Text>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
        >
          {itemError ? (
            <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>{itemError}</Text>
              <Pressable accessibilityRole="button" onPress={() => setItemReloadKey((value) => value + 1)} hitSlop={10}>
                <Text style={[styles.errorAction, { color: palette.danger }]}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {saveError ? (
            <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>{saveError}</Text>
            </View>
          ) : null}
          {customizationBlocked ? (
            <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
              <MaterialCommunityIcons name="link-variant-off" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>
                Allocate this item to the shop before customizing shop-only fields.
              </Text>
            </View>
          ) : null}

          {canEditSharedFields ? (
            <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={[styles.imagePreview, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
                {currentImageUri ? (
                  <Image
                    source={{ uri: currentImageUri }}
                    contentFit="cover"
                    recyclingKey={currentImageUri}
                    style={StyleSheet.absoluteFill}
                    onError={() => {
                      if (currentImageIsDraft) {
                        setImageError("Selected image could not be previewed. Choose another square image.");
                        return;
                      }
                      if (hasStoredImage) {
                        setStoredImageFailed(true);
                        setImageError("Stored image is missing in RustFS. Pick a replacement image and save.");
                      }
                    }}
                  />
                ) : (
                  <MaterialCommunityIcons name="image-plus" size={30} color={palette.textMuted} />
                )}
              </View>
              <YStack flex={1} gap={8}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Image</Text>
                <Text style={[styles.sectionHint, { color: palette.textMuted }]}>Square image for admin and billing item rows.</Text>
                {imageStatus ? <Text style={[styles.imageMessage, { color: palette.textMuted }]}>{imageStatus}</Text> : null}
                {imageError ? <Text style={[styles.imageMessage, { color: palette.danger }]}>{imageError}</Text> : null}
                <XStack gap={8} flexWrap="wrap">
                  <EditorButton label="Pick image" icon="image-edit-outline" onPress={pickImage} palette={palette} />
                  {imageDraft || hasStoredImage || removeImageRequested ? (
                    <EditorButton
                      label={removeImageRequested ? "Undo remove" : imageDraft ? "Clear" : "Remove"}
                      icon="image-remove-outline"
                      onPress={removeImage}
                      palette={palette}
                      danger
                    />
                  ) : null}
                </XStack>
              </YStack>
            </View>
          ) : (
            <View style={[styles.infoBox, { borderColor: palette.gold, backgroundColor: palette.goldSoft }]}>
              <MaterialCommunityIcons name="information-outline" size={18} color={palette.cash} />
              <Text style={[styles.infoText, { color: palette.textPrimary }]}>
                Shared image, unit, and category fields stay in Catalogue.
              </Text>
            </View>
          )}

          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <EditorField
                label="English name"
                value={field.value}
                placeholder="Chicken curry cut"
                errorText={errors.name?.message}
                onChangeText={field.onChange}
                palette={palette}
              />
            )}
          />
          <Controller
            control={control}
            name="tamilName"
            render={({ field }) => (
              <EditorField
                label="Tamil name"
                value={field.value}
                placeholder="தமிழ் பெயர்"
                errorText={errors.tamilName?.message}
                onChangeText={field.onChange}
                palette={palette}
              />
            )}
          />

          {canEditSharedFields ? (
            <>
              <XStack gap={8}>
                <EditorButton
                  label="Weight"
                  icon="scale-balance"
                  active={unitType === "weight"}
                  onPress={() => {
                    setValue("unitType", "weight", { shouldDirty: true, shouldValidate: true });
                    setValue("baseUnit", "kg", { shouldDirty: true, shouldValidate: true });
                  }}
                  palette={palette}
                  flex
                />
                <EditorButton
                  label="Count"
                  icon="counter"
                  active={unitType === "count"}
                  onPress={() => {
                    setValue("unitType", "count", { shouldDirty: true, shouldValidate: true });
                    setValue("baseUnit", "unit", { shouldDirty: true, shouldValidate: true });
                  }}
                  palette={palette}
                  flex
                />
              </XStack>
              <CategoryManager
                categories={categories}
                selectedCategoryId={selectedCategoryId}
                draftName={categoryDraft}
                loading={categoriesLoading}
                errorMessage={categoryError}
                palette={palette}
                onChangeDraftName={setCategoryDraft}
                onRetry={() => void loadCategories()}
                onSelect={(category) => {
                  setValue("categoryId", category?.id ?? "", { shouldDirty: true, shouldValidate: true });
                  setValue("category", category?.name ?? "", { shouldDirty: true, shouldValidate: true });
                }}
                onAdd={() => void addCategory()}
                onDelete={removeCategory}
              />
            </>
          ) : null}

          <XStack gap={10}>
            <EditorButton label="Cancel" icon="close-circle-outline" onPress={() => navigation.goBack()} palette={palette} flex />
            <EditorButton
              label={saving ? "Saving..." : "Save item"}
              icon="content-save-outline"
              onPress={saveItem}
              palette={palette}
              active
              loading={saving}
              disabled={saveDisabled}
              flex
            />
          </XStack>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EditorField({
  label,
  value,
  placeholder,
  keyboardType,
  multiline,
  errorText,
  palette,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  keyboardType?: "default" | "number-pad";
  multiline?: boolean;
  errorText?: string;
  palette: ThemePalette;
  onChangeText: (value: string) => void;
}) {
  return (
    <YStack gap={7}>
      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{label}</Text>
      <Input
        value={value}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted as never}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        minHeight={multiline ? 92 : 48}
        borderRadius={12}
        borderWidth={1}
        borderColor={errorText ? palette.danger : palette.border}
        backgroundColor={palette.surfaceMuted}
        color={palette.textPrimary}
        fontSize={15}
        fontWeight="700"
      />
      {errorText ? <Text style={[styles.fieldError, { color: palette.danger }]}>{errorText}</Text> : null}
    </YStack>
  );
}

function CategoryManager({
  categories,
  selectedCategoryId,
  draftName,
  loading,
  errorMessage,
  palette,
  onChangeDraftName,
  onRetry,
  onSelect,
  onAdd,
  onDelete,
}: {
  categories: ItemCategoryRead[];
  selectedCategoryId: UUID | "";
  draftName: string;
  loading: boolean;
  errorMessage: string | null;
  palette: ThemePalette;
  onChangeDraftName: (value: string) => void;
  onRetry: () => void;
  onSelect: (category: ItemCategoryRead | null) => void;
  onAdd: () => void;
  onDelete: (category: ItemCategoryRead) => void;
}) {
  return (
    <View style={[styles.categoryPanel, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <YStack flex={1} minWidth={0}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Category</Text>
          <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
            Create the catalogue groups users need, then choose one for this item.
          </Text>
        </YStack>
        {loading ? <Spinner color={palette.emerald} size="small" /> : null}
      </XStack>

      {errorMessage ? (
        <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={10}>
            <Text style={[styles.errorAction, { color: palette.danger }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <XStack gap={8} alignItems="center">
        <Input
          value={draftName}
          placeholder="New category"
          placeholderTextColor={palette.textMuted as never}
          onChangeText={onChangeDraftName}
          flex={1}
          minHeight={42}
          borderRadius={10}
          borderWidth={1}
          borderColor={palette.border}
          backgroundColor={palette.surfaceMuted}
          color={palette.textPrimary}
          fontSize={14}
          fontWeight="800"
        />
        <EditorButton label="Add" icon="plus" onPress={onAdd} palette={palette} disabled={loading} />
      </XStack>

      <XStack gap={8} flexWrap="wrap">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: selectedCategoryId === "" }}
          onPress={() => onSelect(null)}
          style={[
            styles.categoryChip,
            {
              borderColor: selectedCategoryId === "" ? palette.emerald : palette.border,
              backgroundColor: selectedCategoryId === "" ? palette.emeraldSoft : palette.surfaceMuted,
            },
          ]}
        >
          <Text
            style={[
              styles.categoryChipText,
              { color: selectedCategoryId === "" ? palette.emeraldDark : palette.textPrimary },
            ]}
          >
            None
          </Text>
        </Pressable>
        {categories.map((category) => {
          const selected = selectedCategoryId === category.id;
          return (
            <View
              key={category.id}
              style={[
                styles.categoryChip,
                {
                  borderColor: selected ? palette.emerald : palette.border,
                  backgroundColor: selected ? palette.emeraldSoft : palette.surfaceMuted,
                },
              ]}
            >
              <Pressable accessibilityRole="button" onPress={() => onSelect(category)} style={styles.categoryChipLabel}>
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: selected ? palette.emeraldDark : palette.textPrimary },
                  ]}
                >
                  {category.name}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onDelete(category)} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={15} color={palette.danger} />
              </Pressable>
            </View>
          );
        })}
      </XStack>
    </View>
  );
}

function AttributeEditor({
  fields,
  control,
  watchedAttributes,
  palette,
  onAppend,
  onRemove,
  onCycleType,
  onToggleBoolean,
}: {
  fields: { id: string }[];
  control: ReturnType<typeof useForm<EditorValues>>["control"];
  watchedAttributes: EditorValues["attributes"];
  palette: ThemePalette;
  onAppend: () => void;
  onRemove: (index: number) => void;
  onCycleType: (index: number, valueType: AttributeValueType) => void;
  onToggleBoolean: (index: number, currentValue: string) => void;
}) {
  return (
    <View style={[styles.attributesPanel, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <YStack flex={1} minWidth={0}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Custom attributes</Text>
          <Text style={[styles.sectionHint, { color: palette.textMuted }]}>Typed key/value details for future filtering and shop customization.</Text>
        </YStack>
        <EditorButton label="Add" icon="plus" onPress={onAppend} palette={palette} />
      </XStack>

      {fields.length === 0 ? (
        <View style={[styles.emptyAttributes, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.sectionHint, { color: palette.textMuted }]}>No attributes yet.</Text>
        </View>
      ) : (
        <YStack gap={9}>
          {fields.map((field, index) => {
            const valueType = watchedAttributes[index]?.valueType ?? "text";
            const value = watchedAttributes[index]?.value ?? "";
            return (
              <View key={field.id} style={[styles.attributeRow, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
                <Controller
                  control={control}
                  name={`attributes.${index}.key`}
                  render={({ field: keyField, fieldState }) => (
                    <View style={styles.attributeKey}>
                      <Input
                        value={keyField.value}
                        placeholder="Key"
                        placeholderTextColor={palette.textMuted as never}
                        onChangeText={keyField.onChange}
                        minHeight={40}
                        borderRadius={10}
                        borderWidth={1}
                        borderColor={fieldState.error ? palette.danger : palette.border}
                        backgroundColor={palette.card}
                        color={palette.textPrimary}
                        fontSize={13}
                        fontWeight="800"
                      />
                    </View>
                  )}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onCycleType(index, valueType)}
                  style={[styles.typeButton, { borderColor: palette.border, backgroundColor: palette.card }]}
                >
                  <Text style={[styles.typeText, { color: palette.textPrimary }]}>
                    {valueType === "text" ? "Text" : valueType === "number" ? "Number" : valueType === "boolean" ? "Bool" : "Null"}
                  </Text>
                </Pressable>
                {valueType === "boolean" ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onToggleBoolean(index, value)}
                    style={[styles.booleanButton, { borderColor: palette.emerald, backgroundColor: palette.emeraldSoft }]}
                  >
                    <Text style={[styles.typeText, { color: palette.emeraldDark }]}>
                      {value === "false" ? "False" : "True"}
                    </Text>
                  </Pressable>
                ) : valueType === "null" ? (
                  <View style={[styles.nullValue, { borderColor: palette.border, backgroundColor: palette.card }]}>
                    <Text style={[styles.typeText, { color: palette.textMuted }]}>Null</Text>
                  </View>
                ) : (
                  <Controller
                    control={control}
                    name={`attributes.${index}.value`}
                    render={({ field: valueField, fieldState }) => (
                      <Input
                        value={valueField.value}
                        placeholder="Value"
                        placeholderTextColor={palette.textMuted as never}
                        keyboardType={valueType === "number" ? "decimal-pad" : "default"}
                        onChangeText={valueField.onChange}
                        flex={1}
                        minHeight={40}
                        borderRadius={10}
                        borderWidth={1}
                        borderColor={fieldState.error ? palette.danger : palette.border}
                        backgroundColor={palette.card}
                        color={palette.textPrimary}
                        fontSize={13}
                        fontWeight="800"
                      />
                    )}
                  />
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRemove(index)}
                  style={styles.removeAttributeButton}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.danger} />
                </Pressable>
              </View>
            );
          })}
        </YStack>
      )}
    </View>
  );
}

function EditorButton({
  label,
  icon,
  active,
  danger,
  loading,
  disabled,
  flex,
  palette,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  flex?: boolean;
  palette: ThemePalette;
  onPress: () => void;
}) {
  const backgroundColor = active ? palette.emerald : danger ? palette.dangerSoft : palette.card;
  const borderColor = active ? palette.emerald : danger ? palette.danger : palette.border;
  const textColor = active ? "#FFFFFF" : danger ? palette.danger : palette.textPrimary;
  return (
    <TButton
      accessibilityRole="button"
      onPress={onPress}
      disabled={loading || disabled}
      flex={flex ? 1 : undefined}
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
          <Text numberOfLines={1} style={[styles.buttonText, { color: textColor }]}>{label}</Text>
        </XStack>
      )}
    </TButton>
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
    gap: 14,
    padding: 16,
  },
  panel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  imagePreview: {
    width: 88,
    height: 88,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 9,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  imageMessage: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  fieldError: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "900",
    flexShrink: 1,
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
  categoryPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  categoryChip: {
    minHeight: 34,
    maxWidth: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  categoryChipLabel: {
    minHeight: 32,
    justifyContent: "center",
  },
  categoryChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  attributesPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  emptyAttributes: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  attributeRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  attributeKey: {
    flex: 1,
    minWidth: 82,
  },
  typeButton: {
    minWidth: 64,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  booleanButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  nullValue: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  typeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  removeAttributeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
