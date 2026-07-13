import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";

import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { AdminTextField } from "@/screens/admin/components/admin-text-field";

import { formatApiErrorMessage } from "@/api/client";
import {
  createExpenseItem,
  deleteExpenseItem,
  deleteExpenseItemImage,
  replaceExpenseItemImageFile,
  updateExpenseItem,
} from "@/api/expenses";
import type { AdminExpenseItemEditorScreenProps } from "@/navigation/types";
import { getItemThumbnailUri, resolveEditorImageUri } from "@/utils/item-images";
import { deleteImageDraftFile, loadImagePickerModule, prepareImageDraftForUpload, type ImageDraft } from "@/utils/media-upload";
import {
  AdminGlobalImageTemplatePickerModal,
  chooseImageSourceAlert,
  useGlobalImageTemplatePicker,
} from "./components/admin-global-image-template-picker";
import { useAdminTheme } from "./use-admin-theme";

type RouteProps = AdminExpenseItemEditorScreenProps["route"];
type NavProps = AdminExpenseItemEditorScreenProps["navigation"];

export function AdminExpenseItemEditorScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();

  const { initialItem } = route.params || {};
  const editingItem = initialItem ?? null;

  const [nameDraft, setNameDraft] = useState(editingItem?.name ?? "");
  const [tamilNameDraft, setTamilNameDraft] = useState(editingItem?.tamil_name ?? "");
  const [activeDraft, setActiveDraft] = useState(editingItem?.is_active ?? true);
  const [savingItem, setSavingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);

  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
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
    initialTemplateId: editingItem?.global_image_template_id ?? null,
  });

  useEffect(() => {
    setSelectedTemplateId(editingItem?.global_image_template_id ?? null);
  }, [editingItem?.global_image_template_id, setSelectedTemplateId]);

  useEffect(() => {
    return () => {
      void deleteImageDraftFile(imageDraft);
    };
  }, [imageDraft]);

  const hasStoredImage = Boolean(editingItem?.image_path || editingItem?.image_thumb_path || editingItem?.global_image_template_id);
  const currentImageUri = resolveEditorImageUri({
    imageDraftUri: imageDraft?.uri,
    removeImageRequested,
    selectedTemplateId,
    templatePreviewUri,
    storedImageUri: editingItem ? getItemThumbnailUri(editingItem) : "",
  });

  const pickImageFromDevice = useCallback(async () => {
    setImageError(null);
    setImageStatus("Opening image picker...");
    const imagePicker = await loadImagePickerModule();
    if (!imagePicker) {
      setImageStatus(null);
      setImageError("Image picker is not available in this app build.");
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
      void deleteImageDraftFile(imageDraft);
      setImageDraft(draft);
      setRemoveImageRequested(false);
      setImageError(null);
      setImageStatus("Ready to upload when you save.");
    } catch (error) {
      setImageStatus(null);
      setImageError(error instanceof Error && error.message ? error.message : "Unable to pick image.");
    }
  }, [imageDraft]);

  const chooseImageSource = useCallback(() => {
    chooseImageSourceAlert({
      onChooseTemplate: () => void openTemplatePicker(),
      onUploadFromDevice: () => void pickImageFromDevice(),
    });
  }, [openTemplatePicker, pickImageFromDevice]);

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
    if (hasStoredImage || selectedTemplateId) {
      setRemoveImageRequested(true);
      setSelectedTemplateId(null);
      setImageError(null);
      setImageStatus("Stored image will be removed when you save.");
    }
  }, [hasStoredImage, imageDraft, removeImageRequested, selectedTemplateId, setSelectedTemplateId]);

  const saveExpenseItem = useCallback(async () => {
    const name = nameDraft.trim();
    const tamilName = tamilNameDraft.trim();
    const sortOrder = editingItem?.sort_order ?? 0;
    if (name.length < 2 || !tamilName) {
      Alert.alert("Check expense item", "Enter name and Tamil name.");
      return;
    }
    setSavingItem(true);
    try {
      const baselineTemplateId = editingItem?.global_image_template_id ?? null;
      const hasTemplateChange = selectedTemplateId !== baselineTemplateId;
      const templatePayload =
        !imageDraft && (hasTemplateChange || removeImageRequested)
          ? {
              use_global_image_template: true as const,
              global_image_template_id: removeImageRequested ? null : selectedTemplateId,
            }
          : !imageDraft && !editingItem && selectedTemplateId
            ? { global_image_template_id: selectedTemplateId }
            : {};
      if (editingItem) {
        await updateExpenseItem(editingItem.id, {
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
          ...templatePayload,
        });
        if (imageDraft) {
          await replaceExpenseItemImageFile(editingItem.id, imageDraft);
        } else if (
          removeImageRequested &&
          hasStoredImage &&
          (editingItem.image_path || editingItem.image_thumb_path)
        ) {
          await deleteExpenseItemImage(editingItem.id);
        }
      } else {
        const createdItem = await createExpenseItem({
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
          ...templatePayload,
        });
        if (imageDraft) {
          try {
            await replaceExpenseItemImageFile(createdItem.id, imageDraft);
          } catch (error) {
            await deleteExpenseItem(createdItem.id).catch(() => undefined);
            throw error;
          }
        }
      }
      void deleteImageDraftFile(imageDraft);
      setImageDraft(null);
      triggerHaptic();
      navigation.goBack();
    } catch (error) {
      Alert.alert("Save failed", formatApiErrorMessage(error, "Unable to save expense item."));
    } finally {
      setSavingItem(false);
    }
  }, [
    activeDraft,
    editingItem,
    hasStoredImage,
    imageDraft,
    nameDraft,
    removeImageRequested,
    selectedTemplateId,
    tamilNameDraft,
    navigation,
  ]);

  const handleDelete = useCallback(() => {
    if (!editingItem) return;
    Alert.alert("Delete Expense Item", `Are you sure you want to delete ${editingItem.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingItem(true);
          try {
            await deleteExpenseItem(editingItem.id);
            triggerHaptic();
            navigation.goBack();
          } catch (error) {
            Alert.alert("Delete failed", formatApiErrorMessage(error, "Unable to delete expense item."));
            setDeletingItem(false);
          }
        },
      },
    ]);
  }, [editingItem, navigation]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["left", "right"]}>
      <StatusBar style="light" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          backgroundColor: palette.shell,
          borderBottomColor: palette.shellBorder,
          paddingTop: Math.max(insets.top - 8, 0),
        }}
      >
        <Pressable onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "900", color: palette.onShell }}>
          {editingItem ? "Edit expense item" : "New expense item"}
        </Text>
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scrollContent, { gap: 16 }]}
        enableOnAndroid
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AdminTextField label="Name" value={nameDraft} onChangeText={setNameDraft} placeholder="Example: Transport" palette={palette} />
        <AdminTextField label="Tamil name" value={tamilNameDraft} onChangeText={setTamilNameDraft} placeholder="தமிழ் பெயர்" palette={palette} />
        
        <View style={[styles.imagePanel, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <ItemThumbnail
                uri={currentImageUri}
                recyclingKey={editingItem?.id ?? "new-expense-item"}
                size={76}
                borderRadius={16}
                backgroundColor={palette.card}
                borderColor={palette.border}
                icon="image-plus"
                iconColor={palette.textMuted}
                iconSize={28}
              />
              <View style={styles.rowBody}>
                <Text style={[styles.switchTitle, { color: palette.textPrimary }]}>Image</Text>
                <Text style={[styles.switchSubtitle, { color: palette.textMuted }]}>
                  Optional square image for expense rows.
                </Text>
                {imageStatus ? <Text style={[styles.imageMessage, { color: palette.textMuted }]}>{imageStatus}</Text> : null}
                {imageError ? <Text style={[styles.imageMessage, { color: palette.danger }]}>{imageError}</Text> : null}
                {selectedTemplate ? (
                  <Text style={[styles.imageMessage, { color: palette.textMuted }]}>
                    Shared template: {selectedTemplate.name}
                  </Text>
                ) : null}
                <View style={styles.imageActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={chooseImageSource}
                    style={[styles.imageActionButton, { backgroundColor: palette.card, borderColor: palette.border }]}
                  >
                    <MaterialCommunityIcons name="image-edit-outline" size={16} color={palette.textPrimary} />
                    <Text style={[styles.imageActionText, { color: palette.textPrimary }]}>Pick image</Text>
                  </Pressable>
                  {imageDraft || hasStoredImage || removeImageRequested || selectedTemplateId ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={removeImage}
                      style={[styles.imageActionButton, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}
                    >
                      <MaterialCommunityIcons name="image-remove-outline" size={16} color={palette.danger} />
                      <Text style={[styles.imageActionText, { color: palette.danger }]}>
                        {removeImageRequested ? "Undo" : imageDraft ? "Clear" : "Remove"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>

        {editingItem && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 14,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontWeight: "600" }}>Active</Text>
            <Switch value={activeDraft} onValueChange={setActiveDraft} />
          </View>
        )}
        <Pressable
          onPress={() => void saveExpenseItem()}
          disabled={savingItem || deletingItem}
          style={{
            marginTop: 8,
            borderRadius: adminRadii.card,
            backgroundColor: palette.primary,
            paddingVertical: 14,
            alignItems: "center",
            opacity: savingItem || deletingItem ? 0.7 : 1,
          }}
        >
          {savingItem ? (
            <ActivityIndicator color={palette.onPrimary} />
          ) : (
            <Text style={{ color: palette.onPrimary, fontWeight: "700" }}>Save expense item</Text>
          )}
        </Pressable>
        {editingItem && (
          <Pressable
            onPress={handleDelete}
            disabled={savingItem || deletingItem || !editingItem.can_delete}
            style={{
              marginTop: 4,
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.danger,
              backgroundColor: palette.dangerSoft,
              paddingVertical: 14,
              alignItems: "center",
              opacity: savingItem || deletingItem || !editingItem.can_delete ? 0.6 : 1,
            }}
          >
            {deletingItem ? (
              <ActivityIndicator color={palette.danger} />
            ) : (
              <Text style={{ color: palette.danger, fontWeight: "700" }}>
                {editingItem.can_delete ? "Delete item" : "Cannot delete — has billing history"}
              </Text>
            )}
          </Pressable>
        )}
      </KeyboardAwareScrollView>
      <AdminGlobalImageTemplatePickerModal
        visible={templatePickerOpen}
        palette={palette}
        templates={imageTemplates}
        loading={imageTemplatesLoading}
        selectedTemplateId={selectedTemplateId}
        accentColor={palette.cash}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(templateId) => {
          setSelectedTemplateId(templateId);
          void deleteImageDraftFile(imageDraft);
          setImageDraft(null);
          setRemoveImageRequested(false);
          setImageStatus("Shared template selected. Save to apply.");
        }}
        onUploadFromDevice={() => void pickImageFromDevice()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  imagePanel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  switchTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  switchSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  imageMessage: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    marginTop: 4,
  },
  imageActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  imageActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
  },
  imageActionText: {
    fontSize: 12,
    fontWeight: "800",
  },
});
