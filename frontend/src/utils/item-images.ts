import { Image } from "expo-image";

import { resolveApiUrl } from "@/api/client";

type ItemImageFields = {
  image_path?: string | null;
  image_thumb_path?: string | null;
};

export function getItemThumbnailUri(item: ItemImageFields) {
  const imagePath = item.image_thumb_path || item.image_path || "";
  return imagePath ? resolveApiUrl(imagePath) : "";
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
  void Image.prefetch(urls, "memory-disk").catch(() => undefined);
}
