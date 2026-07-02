import * as FileSystem from "expo-file-system/legacy";
import type { ImagePickerAsset as PickedImageAsset } from "expo-image-picker";
type ExpoImagePickerModule = typeof import("expo-image-picker");

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const IMAGE_UPLOAD_DRAFT_DIR = "duropos-image-uploads/";

export type ImageDraft = {
  uri: string;
  name: string;
  type: string;
  size: number | null;
};

export async function loadImagePickerModule(): Promise<ExpoImagePickerModule | null> {
  try {
    return await import("expo-image-picker");
  } catch {
    return null;
  }
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
  const uploadDirectory = `${parentDirectory}${IMAGE_UPLOAD_DRAFT_DIR}`;
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

async function copyImageToUploadDraftDirectory(sourceUri: string, name: string) {
  const uploadDirectory = await ensureImageUploadDraftDirectory();
  const cachedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;
  const cachedUri = `${uploadDirectory.replace(/\/$/, "")}/${cachedName}`;
  await FileSystem.copyAsync({ from: sourceUri, to: cachedUri });
  return cachedUri;
}

export async function deleteImageDraftFile(draft: ImageDraft | null) {
  if (!draft?.uri) {
    return;
  }
  try {
    await FileSystem.deleteAsync(draft.uri, { idempotent: true });
  } catch {
    // Temporary image drafts may already be gone.
  }
}

async function getLocalFileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error("Selected image file is no longer available. Pick it again and save.");
  }
  return typeof info.size === "number" ? info.size : null;
}

export async function prepareImageDraftForUpload(asset: PickedImageAsset): Promise<ImageDraft> {
  const contentType = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const name = normalizedImageFilename(asset, contentType);
  if (!asset.uri) {
    throw new Error("Selected image has no readable file URI. Pick another image.");
  }
  if (typeof asset.fileSize === "number" && asset.fileSize > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `Selected image is ${readableBytes(asset.fileSize)}. Choose an image under ${readableBytes(MAX_IMAGE_UPLOAD_BYTES)}.`,
    );
  }
  const cachedUri = await copyImageToUploadDraftDirectory(asset.uri, name);
  const finalSize = await getLocalFileSize(cachedUri);
  if (typeof finalSize === "number" && finalSize > MAX_IMAGE_UPLOAD_BYTES) {
    await FileSystem.deleteAsync(cachedUri, { idempotent: true });
    throw new Error(
      `Selected image is ${readableBytes(finalSize)}. Choose an image under ${readableBytes(MAX_IMAGE_UPLOAD_BYTES)}.`,
    );
  }
  return {
    uri: cachedUri,
    name,
    type: contentType,
    size: finalSize,
  };
}
