import * as FileSystem from "expo-file-system/legacy";
import { requireOptionalNativeModule } from "expo-modules-core";

type ExpoSharingNativeModule = {
  shareAsync?: (
    url: string,
    options?: { dialogTitle?: string; mimeType?: string; UTI?: string },
  ) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
};

export async function shareReceiptPngBase64(
  base64: string,
  dialogTitle: string,
  fileNamePrefix = "receipt-share",
) {
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) {
    throw new Error("File storage is unavailable on this device.");
  }

  const uri = `${directory}${fileNamePrefix}-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const sharingModule = requireOptionalNativeModule<ExpoSharingNativeModule>("ExpoSharing");
  if (!sharingModule?.shareAsync) {
    throw new Error("Sharing is not available on this device.");
  }

  const available = sharingModule.isAvailableAsync
    ? await sharingModule.isAvailableAsync().catch(() => false)
    : true;
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }

  await sharingModule.shareAsync(uri, {
    dialogTitle,
    mimeType: "image/png",
    UTI: "public.png",
  });
}
