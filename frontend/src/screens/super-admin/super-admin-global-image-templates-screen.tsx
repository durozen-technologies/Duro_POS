import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { SkeletonList } from "@/components/ui/skeleton";
import {
  createSuperAdminGlobalImageTemplate,
  deactivateSuperAdminGlobalImageTemplate,
  fetchSuperAdminGlobalImageTemplates,
  updateSuperAdminGlobalImageTemplate,
} from "@/api/global-image-templates";
import { formatApiErrorMessage, isApiRequestCanceled, resolveApiUrl } from "@/api/client";
import type { AppStackParamList } from "@/navigation/types";
import { hasAuthToken, skipUnlessAuthed } from "@/store/auth-store";
import type { GlobalImageTemplateRead } from "@/types/api";
import { authenticatedImageSource } from "@/utils/item-images";
import {
  deleteImageDraftFile,
  loadImagePickerModule,
  prepareImageDraftForUpload,
  type ImageDraft,
} from "@/utils/media-upload";

import { SUPER_ADMIN_REFRESH_TINT, SuperAdminRefreshButton } from "./super-admin-refresh-button";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminGlobalImageTemplates">;

const ACCENT = "#0F7642";
const INK = "#0A110D";
const MUTED = "#4B6356";

export function SuperAdminGlobalImageTemplatesScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [templates, setTemplates] = useState<GlobalImageTemplateRead[]>([]);
  const [newName, setNewName] = useState("");
  const [createImageDraft, setCreateImageDraft] = useState<ImageDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editImageDraft, setEditImageDraft] = useState<ImageDraft | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (
      skipUnlessAuthed(() => {
        setLoading(false);
        setRefreshing(false);
      })
    ) {
      return;
    }
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const rows = await fetchSuperAdminGlobalImageTemplates(true);
      setTemplates(rows);
    } catch (err) {
      if (isApiRequestCanceled(err) || !hasAuthToken()) {
        return;
      }
      setError(formatApiErrorMessage(err, "Failed to load image templates"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const pickCreateImage = useCallback(async () => {
    const imagePicker = await loadImagePickerModule();
    if (!imagePicker?.launchImageLibraryAsync) {
      Alert.alert("Image picker unavailable", "Reinstall the dev client with expo-image-picker.");
      return;
    }
    const result = await imagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    try {
      const draft = await prepareImageDraftForUpload(result.assets[0]);
      void deleteImageDraftFile(createImageDraft);
      setCreateImageDraft(draft);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Failed to prepare image");
    }
  }, [createImageDraft]);

  const pickEditImage = useCallback(async () => {
    const imagePicker = await loadImagePickerModule();
    if (!imagePicker?.launchImageLibraryAsync) {
      Alert.alert("Image picker unavailable", "Reinstall the dev client with expo-image-picker.");
      return;
    }
    const result = await imagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    try {
      const draft = await prepareImageDraftForUpload(result.assets[0]);
      void deleteImageDraftFile(editImageDraft);
      setEditImageDraft(draft);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Failed to prepare image");
    }
  }, [editImageDraft]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createSuperAdminGlobalImageTemplate({ name }, createImageDraft);
      setNewName("");
      void deleteImageDraftFile(createImageDraft);
      setCreateImageDraft(null);
      await load();
    } catch (err) {
      setError(formatApiErrorMessage(err, "Failed to create template"));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (template: GlobalImageTemplateRead) => {
    setEditingId(template.id);
    setEditName(template.name);
    void deleteImageDraftFile(editImageDraft);
    setEditImageDraft(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    void deleteImageDraftFile(editImageDraft);
    setEditImageDraft(null);
  };

  const saveEdit = async (template: GlobalImageTemplateRead) => {
    const name = editName.trim();
    if (!name) {
      return;
    }
    setBusyId(template.id);
    setError(null);
    try {
      await updateSuperAdminGlobalImageTemplate(
        template.id,
        { name, is_active: template.is_active },
        editImageDraft,
      );
      cancelEdit();
      await load();
    } catch (err) {
      setError(formatApiErrorMessage(err, "Failed to update template"));
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (template: GlobalImageTemplateRead) => {
    if (template.is_active) {
      Alert.alert("Deactivate template?", `${template.name} will stop appearing for tenants.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: () => void doDeactivate(template),
        },
      ]);
      return;
    }
    setBusyId(template.id);
    setError(null);
    try {
      await updateSuperAdminGlobalImageTemplate(template.id, { is_active: true });
      await load();
    } catch (err) {
      setError(formatApiErrorMessage(err, "Failed to activate template"));
    } finally {
      setBusyId(null);
    }
  };

  const doDeactivate = async (template: GlobalImageTemplateRead) => {
    setBusyId(template.id);
    setError(null);
    try {
      await deactivateSuperAdminGlobalImageTemplate(template.id);
      if (editingId === template.id) {
        cancelEdit();
      }
      await load();
    } catch (err) {
      setError(formatApiErrorMessage(err, "Failed to deactivate template"));
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = templates.filter((row) => row.is_active).length;

  const renderTemplate = ({ item: template, index }: { item: GlobalImageTemplateRead; index: number }) => {
    const thumbPath = template.image_thumb_path || template.image_path || "";
    const thumbUri = thumbPath ? resolveApiUrl(thumbPath) : "";
    const isEditing = editingId === template.id;
    const busy = busyId === template.id;

    return (
      <View
        className={`px-4 py-4 ${index < templates.length - 1 ? "border-b border-border" : ""}`}
      >
        <View className="flex-row items-center gap-3">
          <View className="h-14 w-14 overflow-hidden rounded-xl border border-border bg-surface">
            {thumbUri ? (
              <Image
                source={authenticatedImageSource(thumbUri)}
                contentFit="cover"
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <View className="flex-1 items-center justify-center">
                <MaterialCommunityIcons name="image-outline" size={22} color={MUTED} />
              </View>
            )}
          </View>

          <View className="min-w-0 flex-1">
            {isEditing ? (
              <TextInput
                className="min-h-[44px] rounded-control border border-border bg-surface px-3 text-base text-ink"
                value={editName}
                onChangeText={setEditName}
                autoCapitalize="words"
              />
            ) : (
              <>
                <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                  {template.name}
                </Text>
                <Text className="mt-0.5 text-sm text-muted">
                  {template.is_active ? "Active" : "Inactive"} · sort {template.sort_order}
                </Text>
              </>
            )}
          </View>

          {!isEditing ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
              disabled={busyId != null}
              onPress={() => startEdit(template)}
            >
              <MaterialCommunityIcons name="pencil-outline" size={20} color={INK} />
            </Pressable>
          ) : null}
        </View>

        {isEditing ? (
          <View className="mt-3 gap-3">
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                className="rounded-control border border-border bg-card px-4 py-2 active:opacity-80"
                onPress={() => void pickEditImage()}
              >
                <Text className="text-sm font-medium text-ink">
                  {editImageDraft ? "Replace picked image" : "Pick new image"}
                </Text>
              </Pressable>
              {editImageDraft ? (
                <Pressable
                  className="rounded-control border border-border bg-card px-4 py-2 active:opacity-80"
                  onPress={() => {
                    void deleteImageDraftFile(editImageDraft);
                    setEditImageDraft(null);
                  }}
                >
                  <Text className="text-sm font-medium text-danger">Clear pick</Text>
                </Pressable>
              ) : null}
            </View>
            <View className="flex-row gap-2">
              <Pressable
                className={`flex-1 items-center rounded-control bg-accent py-3 ${busy || !editName.trim() ? "opacity-50" : "active:opacity-80"}`}
                disabled={busy || !editName.trim()}
                onPress={() => void saveEdit(template)}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Save</Text>
                )}
              </Pressable>
              <Pressable
                className="flex-1 items-center rounded-control border border-border bg-card py-3 active:opacity-80"
                disabled={busy}
                onPress={cancelEdit}
              >
                <Text className="text-sm font-semibold text-ink">Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="mt-3 flex-row gap-2">
            <Pressable
              className={`rounded-control px-4 py-2 ${template.is_active ? "bg-dangerSoft" : "bg-accent"} ${busy ? "opacity-50" : "active:opacity-80"}`}
              disabled={busyId != null}
              onPress={() => void toggleActive(template)}
            >
              {busy ? (
                <ActivityIndicator size="small" color={template.is_active ? "#DC2626" : "#fff"} />
              ) : (
                <Text className={`text-sm font-medium ${template.is_active ? "text-danger" : "text-white"}`}>
                  {template.is_active ? "Deactivate" : "Activate"}
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const listHeader = (
    <View>
      <View className="mx-4 mb-8 mt-2 rounded-3xl border border-border bg-card p-5 shadow-sm">
        <Text className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          New Image Template
        </Text>
        <TextInput
          accessibilityLabel="Template name"
          autoCapitalize="words"
          className="mb-3 min-h-[48px] rounded-control border border-border bg-surface px-4 text-base text-ink"
          placeholder="e.g. Chicken curry cut"
          placeholderTextColor={MUTED}
          value={newName}
          onChangeText={setNewName}
        />
        <View className="mb-3 flex-row flex-wrap gap-2">
          <Pressable
            className="rounded-control border border-border bg-surface px-4 py-2 active:opacity-80"
            onPress={() => void pickCreateImage()}
          >
            <Text className="text-sm font-medium text-ink">
              {createImageDraft ? "Change Image" : "Pick Image"}
            </Text>
          </Pressable>
          {createImageDraft ? (
            <Pressable
              className="rounded-control border border-border bg-surface px-4 py-2 active:opacity-80"
              onPress={() => {
                void deleteImageDraftFile(createImageDraft);
                setCreateImageDraft(null);
              }}
            >
              <Text className="text-sm font-medium text-danger">Clear Image</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          className={`min-h-[48px] items-center justify-center rounded-control bg-accent ${creating || !newName.trim() ? "opacity-50" : "active:opacity-80"}`}
          disabled={creating || !newName.trim()}
          onPress={() => void handleCreate()}
        >
          {creating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-sm font-semibold text-white">Create template</Text>
          )}
        </Pressable>
        {error ? (
          <View className="mt-4 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : null}
      </View>

      <View className="flex-row items-center border-y border-border bg-surface px-4 py-3">
        <Text className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Templates
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <View className="mx-auto w-full max-w-5xl flex-1" style={{ paddingTop: Math.max(insets.top, 16) }}>
        <View className="flex-row items-center gap-4 px-4 pb-6">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
            onPress={() => navigation.goBack()}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
          </Pressable>
          <View className="flex-1 justify-center">
            <Text className="text-3xl font-bold tracking-tight text-ink">Image Templates</Text>
            {!loading && templates.length > 0 ? (
              <Text className="mt-1 text-sm font-medium text-muted">
                {activeCount} active · {templates.length - activeCount} inactive
              </Text>
            ) : null}
          </View>
          <SuperAdminRefreshButton
            onRefresh={() => void load(true)}
            refreshing={refreshing}
            disabled={creating || busyId != null}
          />
        </View>

        {loading && templates.length === 0 ? (
          <View>
            {listHeader}
            <SkeletonList rows={5} label="Loading image templates" />
          </View>
        ) : (
          <FlatList
            data={templates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 32) }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(true)}
                tintColor={SUPER_ADMIN_REFRESH_TINT}
                colors={[SUPER_ADMIN_REFRESH_TINT]}
              />
            }
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <View className="mt-10 items-center px-8">
                <MaterialCommunityIcons name="image-off-outline" size={40} color={MUTED} />
                <Text className="mt-3 text-center text-sm font-medium text-ink">No templates yet</Text>
                <Text className="mt-1 text-center text-xs text-muted">
                  Create a shared image tenants can pick for catalogue items.
                </Text>
              </View>
            }
            renderItem={renderTemplate}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
