import { Image, type ImageSource } from "expo-image";

import { getApiAuthHeaders, resolveApiUrl } from "@/api/client";

type ItemImageFields = {
  image_path?: string | null;
  image_thumb_path?: string | null;
};

const PROTECTED_CATALOG_IMAGE_URI =
  /\/catalog\/(?:items|inventory-items|expense-items|global-image-templates)\/[^/]+\/image(?:\?|$)/;

export function isProtectedCatalogImageUri(uri: string) {
  return PROTECTED_CATALOG_IMAGE_URI.test(uri);
}

export function authenticatedImageSource(uri: string): ImageSource {
  if (!uri) {
    return { uri: "" };
  }
  if (isProtectedCatalogImageUri(uri)) {
    return { uri, headers: getApiAuthHeaders() };
  }
  return { uri };
}

export function getItemThumbnailUri(item: ItemImageFields) {
  const imagePath = item.image_thumb_path || item.image_path || "";
  return imagePath ? resolveApiUrl(imagePath) : "";
}

export function resolveEditorImageUri({
  imageDraftUri,
  removeImageRequested = false,
  selectedTemplateId = null,
  templatePreviewUri = "",
  storedImageUri = "",
}: {
  imageDraftUri?: string | null;
  removeImageRequested?: boolean;
  selectedTemplateId?: string | null;
  templatePreviewUri?: string;
  storedImageUri?: string;
}) {
  if (removeImageRequested) {
    return "";
  }
  if (imageDraftUri) {
    return imageDraftUri;
  }
  if (selectedTemplateId && templatePreviewUri) {
    return templatePreviewUri;
  }
  return storedImageUri;
}

export function prefetchItemThumbnails(items: ItemImageFields[], limit = 12) {
  const urls = Array.from(
    new Set(
      items
        .slice(0, limit)
        .map(getItemThumbnailUri)
        .filter(Boolean),
    ),
  );
  if (urls.length === 0) {
    return;
  }
  void Image.prefetch(urls, {
    cachePolicy: "memory-disk",
    headers: getApiAuthHeaders(),
  }).catch(() => undefined);
}
