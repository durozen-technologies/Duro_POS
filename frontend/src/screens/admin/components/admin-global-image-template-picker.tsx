import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Spinner } from "tamagui";

import { fetchAdminGlobalImageTemplates } from "@/api/global-image-templates";
import { isApiRequestCanceled, resolveApiUrl } from "@/api/client";
import { authenticatedImageSource } from "@/utils/item-images";
import type { GlobalImageTemplateRead } from "@/types/api";

import { adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";

type UseGlobalImageTemplatePickerOptions = {
  initialTemplateId?: string | null;
};

export function useGlobalImageTemplatePicker({
  initialTemplateId = null,
}: UseGlobalImageTemplatePickerOptions = {}) {
  const [imageTemplates, setImageTemplates] = useState<GlobalImageTemplateRead[]>([]);
  const [imageTemplatesLoading, setImageTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const selectedTemplate = useMemo(
    () => imageTemplates.find((row) => row.id === selectedTemplateId) ?? null,
    [imageTemplates, selectedTemplateId],
  );

  const templatePreviewUri = useMemo(() => {
    const path = selectedTemplate?.image_thumb_path || selectedTemplate?.image_path || "";
    return path ? resolveApiUrl(path) : "";
  }, [selectedTemplate]);

  const loadImageTemplates = useCallback(async (signal?: AbortSignal) => {
    setImageTemplatesLoading(true);
    try {
      const rows = await fetchAdminGlobalImageTemplates();
      if (signal?.aborted) {
        return;
      }
      setImageTemplates(rows);
    } catch (error) {
      if (isApiRequestCanceled(error)) {
        return;
      }
    } finally {
      if (!signal?.aborted) {
        setImageTemplatesLoading(false);
      }
    }
  }, []);

  const openTemplatePicker = useCallback(async () => {
    setTemplatePickerOpen(true);
    if (imageTemplates.length === 0 && !imageTemplatesLoading) {
      await loadImageTemplates();
    }
  }, [imageTemplates.length, imageTemplatesLoading, loadImageTemplates]);

  useEffect(() => {
    if (!initialTemplateId) {
      return;
    }
    void loadImageTemplates();
  }, [initialTemplateId, loadImageTemplates]);

  useEffect(() => {
    if (!selectedTemplateId || selectedTemplate) {
      return;
    }
    void loadImageTemplates();
  }, [loadImageTemplates, selectedTemplate, selectedTemplateId]);

  return {
    imageTemplates,
    imageTemplatesLoading,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    templatePreviewUri,
    templatePickerOpen,
    setTemplatePickerOpen,
    loadImageTemplates,
    openTemplatePicker,
  };
}

export function chooseImageSourceAlert({
  onChooseTemplate,
  onUploadFromDevice,
}: {
  onChooseTemplate: () => void;
  onUploadFromDevice: () => void;
}) {
  Alert.alert("Pick image", "Choose a shared template or upload from your device.", [
    { text: "Choose shared template", onPress: onChooseTemplate },
    { text: "Upload from device", onPress: onUploadFromDevice },
    { text: "Cancel", style: "cancel" },
  ]);
}

type AdminGlobalImageTemplatePickerModalProps = {
  visible: boolean;
  palette: ThemePalette;
  templates: GlobalImageTemplateRead[];
  loading: boolean;
  selectedTemplateId: string | null;
  accentColor: string;
  onClose: () => void;
  onSelect: (templateId: string) => void;
  onUploadFromDevice: () => void;
};

export function AdminGlobalImageTemplatePickerModal({
  visible,
  palette,
  templates,
  loading,
  selectedTemplateId,
  accentColor,
  onClose,
  onSelect,
  onUploadFromDevice,
}: AdminGlobalImageTemplatePickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityRole="none"
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={[styles.title, { color: palette.textPrimary }]}>Shared image templates</Text>
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            Tap a template. Custom upload still overrides template when you save.
          </Text>
          {loading ? (
            <View style={styles.state}>
              <Spinner color={accentColor} />
              <Text style={[styles.hint, { color: palette.textMuted }]}>Loading templates...</Text>
            </View>
          ) : templates.length === 0 ? (
            <View style={styles.state}>
              <Text style={[styles.hint, { color: palette.textMuted }]}>
                No shared templates yet. Upload from your device instead.
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[styles.action, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
                onPress={() => {
                  onClose();
                  onUploadFromDevice();
                }}
              >
                <MaterialCommunityIcons name="image-edit-outline" size={16} color={accentColor} />
                <Text style={[styles.actionText, { color: palette.textPrimary }]}>Upload from device</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.list}>
              {templates.map((template) => {
                const thumbPath = template.image_thumb_path || template.image_path || "";
                const thumbUri = thumbPath ? resolveApiUrl(thumbPath) : "";
                const selected = selectedTemplateId === template.id;
                return (
                  <Pressable
                    key={template.id}
                    accessibilityRole="button"
                    accessibilityLabel={template.name}
                    onPress={() => {
                      onSelect(template.id);
                      onClose();
                    }}
                    style={[
                      styles.templateCard,
                      {
                        borderColor: selected ? accentColor : palette.border,
                        backgroundColor: selected ? palette.surfaceMuted : palette.card,
                      },
                    ]}
                  >
                    {thumbUri ? (
                      <Image
                        source={authenticatedImageSource(thumbUri)}
                        style={styles.templateImage}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.templateImage, { backgroundColor: palette.surfaceMuted }]} />
                    )}
                    <Text numberOfLines={2} style={[styles.templateLabel, { color: palette.textPrimary }]}>
                      {template.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: adminSpacing.lg,
    gap: adminSpacing.sm,
  },
  title: {
    ...adminTypography.sectionTitle,
  },
  hint: {
    ...adminTypography.caption,
    textTransform: "none",
  },
  state: {
    alignItems: "center",
    gap: adminSpacing.sm,
    paddingVertical: adminSpacing.md,
  },
  list: {
    gap: adminSpacing.sm,
    paddingVertical: adminSpacing.xs,
  },
  templateCard: {
    width: 112,
    borderRadius: 12,
    borderWidth: 1,
    padding: adminSpacing.xs,
    gap: adminSpacing.xs,
  },
  templateImage: {
    width: 96,
    height: 96,
    borderRadius: 10,
  },
  templateLabel: {
    ...adminTypography.caption,
    textTransform: "none",
    textAlign: "center",
    minHeight: 32,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: adminSpacing.sm,
  },
  actionText: {
    ...adminTypography.bodyStrong,
  },
});
