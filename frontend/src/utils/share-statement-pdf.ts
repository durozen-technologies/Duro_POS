import * as Print from "expo-print";
import { requireOptionalNativeModule } from "expo-modules-core";

type ExpoSharingNativeModule = {
  shareAsync?: (
    url: string,
    options?: { dialogTitle?: string; mimeType?: string; UTI?: string },
  ) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
};

export async function shareStatementPdf(html: string, dialogTitle: string) {
  const printResult = await Print.printToFileAsync({ html });
  if (!printResult.uri) {
    throw new Error("Statement PDF could not be generated on this device.");
  }

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

  await sharingModule.shareAsync(printResult.uri, {
    dialogTitle,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}
