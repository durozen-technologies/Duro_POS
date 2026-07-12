import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { AdminTextField } from "@/screens/admin/components/admin-text-field";

import { toApiError, formatApiErrorMessage } from "@/api/client";
import {
  createExpenseItem,
  deleteExpenseItem,
  deleteExpenseItemImage,
  replaceExpenseItemImageFile,
  updateExpenseItem,
} from "@/api/expenses";
import type { AdminExpenseItemEditorScreenProps } from "@/navigation/types";
import { getItemThumbnailUri } from "@/utils/item-images";
import { deleteImageDraftFile, loadImagePickerModule, prepareImageDraftForUpload, type ImageDraft } from "@/utils/media-upload";
import { useAdminTheme } from "./use-admin-theme";

type RouteProps = AdminExpenseItemEditorScreenProps["route"];
type NavProps = AdminExpenseItemEditorScreenProps["navigation"];

export function AdminExpenseItemEditorScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
  const { palette } = useAdminTheme();

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

  useEffect(() => {
    return () => {
      void deleteImageDraftFile(imageDraft);
    };
  }, [imageDraft]);

  const hasStoredImage = Boolean(editingItem?.image_path || editingItem?.image_thumb_path);
  const currentImageUri = removeImageRequested
    ? ""
    : imageDraft?.uri ?? (editingItem ? getItemThumbnailUri(editingItem) : "");

  const pickImage = useCallback(async () => {
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
    if (hasStoredImage) {
      setRemoveImageRequested(true);
      setImageError(null);
      setImageStatus("Stored image will be removed when you save.");
    }
  }, [hasStoredImage, imageDraft, removeImageRequested]);

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
      if (editingItem) {
        await updateExpenseItem(editingItem.id, {
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
        });
        if (imageDraft) {
          await replaceExpenseItemImageFile(editingItem.id, imageDraft);
        } else if (removeImageRequested && hasStoredImage) {
          await deleteExpenseItemImage(editingItem.id);
        }
      } else {
        const createdItem = await createExpenseItem({
          name,
          tamil_name: tamilName,
          sort_order: sortOrder,
          is_active: activeDraft,
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
    tamilNameDraft,
    navigation
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
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={[styles.topBar, { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.onShell }]}>
            {editingItem ? "Edit Expense Item" : "New Expense Item"}
          </Text>
          <Text style={[styles.subtitle, { color: palette.onShellMuted }]}>
            Branch expense control
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={saveExpenseItem}
          disabled={savingItem}
          style={[styles.saveButton, { backgroundColor: palette.success }]}
        >
          {savingItem ? (
            <ActivityIndicator color={palette.card} size="small" />
          ) : (
            <Text style={[styles.saveButtonText, { color: palette.card }]}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <AdminTextField label="Name" value={nameDraft} onChangeText={setNameDraft} placeholder="Example: Transport" palette={palette} />
            <AdminTextField label="Tamil name" value={tamilNameDraft} onChangeText={setTamilNameDraft} placeholder="தமிழ் பெயர்" palette={palette} />
            
            <View style={[styles.imagePanel, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
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
                <View style={styles.imageActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={pickImage}
                    style={[styles.imageActionButton, { backgroundColor: palette.card, borderColor: palette.border }]}
                  >
                    <MaterialCommunityIcons name="image-edit-outline" size={16} color={palette.cash} />
                    <Text style={[styles.imageActionText, { color: palette.textPrimary }]}>Pick image</Text>
                  </Pressable>
                  {imageDraft || hasStoredImage || removeImageRequested ? (
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
              <>
                <View style={[styles.switchRow, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                  <View style={styles.rowBody}>
                    <Text style={[styles.switchTitle, { color: palette.textPrimary }]}>Active</Text>
                    <Text style={[styles.switchSubtitle, { color: palette.textMuted }]}>
                      Inactive expense items cannot be allocated to branches.
                    </Text>
                  </View>
                  <Switch
                    value={activeDraft}
                    onValueChange={setActiveDraft}
                    trackColor={{ false: palette.border, true: palette.cash }}
                    thumbColor={Platform.OS === "ios" ? undefined : palette.card}
                  />
                </View>

                <View style={[styles.deleteSection, { borderTopColor: palette.border }]}>
                  <Text style={[styles.deleteSectionLabel, { color: palette.textMuted }]}>
                    Danger zone
                  </Text>
                  
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleDelete}
                    disabled={!editingItem.can_delete || savingItem || deletingItem}
                    style={[
                      styles.deleteButton,
                      {
                        backgroundColor: !editingItem.can_delete ? palette.surfaceMuted : palette.dangerSoft,
                        borderColor: !editingItem.can_delete ? palette.border : palette.danger,
                        opacity: (!editingItem.can_delete || savingItem || deletingItem) ? 0.6 : 1,
                      }
                    ]}
                  >
                    {deletingItem ? (
                      <ActivityIndicator color={palette.danger} size="small" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color={!editingItem.can_delete ? palette.textMuted : palette.danger} />
                        <Text style={[styles.deleteButtonText, { color: !editingItem.can_delete ? palette.textMuted : palette.danger }]}>
                          Delete item
                        </Text>
                      </>
                    )}
                  </Pressable>

                  {!editingItem.can_delete ? (
                    <Text style={[styles.deleteBlockedText, { color: palette.warning }]}>
                      Cannot Delete - has Billing History.
                    </Text>
                  ) : (
                    <Text style={[styles.deleteHintText, { color: palette.textMuted }]}>
                      Only expense items without entry history can be deleted.
                    </Text>
                  )}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
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
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  saveButton: {
    minHeight: 40,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 16,
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  switchIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
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
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
  },
  deleteButtonText: {
    fontSize: 14,
    fontFamily: "Inter-Bold",
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
});
