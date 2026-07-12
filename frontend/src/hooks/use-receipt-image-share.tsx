import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { RECEIPT_SHARE_EXPORT_WEBVIEW_SCRIPT } from "@/api/receipts";
import { shareReceiptPngBase64 } from "@/utils/share-receipt-image";

type ReceiptShareJob = {
  id: string;
  html: string;
  dialogTitle: string;
};

type ReceiptShareBridgeMessage =
  | {
      type: "receipt-share-export";
      payload: string;
    }
  | {
      type: "receipt-export-error";
      payload: string;
    };

function parseBridgeMessage(rawData: string): ReceiptShareBridgeMessage | null {
  try {
    const parsed = JSON.parse(rawData) as Partial<ReceiptShareBridgeMessage>;
    if (
      parsed.type === "receipt-share-export" &&
      typeof parsed.payload === "string"
    ) {
      return parsed as ReceiptShareBridgeMessage;
    }
    if (
      parsed.type === "receipt-export-error" &&
      typeof parsed.payload === "string"
    ) {
      return parsed as ReceiptShareBridgeMessage;
    }
  } catch {
    // Ignore non-JSON messages from the WebView.
  }

  return null;
}

function ReceiptImageShareBridge({
  job,
  onComplete,
  onError,
}: {
  job: ReceiptShareJob | null;
  onComplete: () => void;
  onError: (error: Error) => void;
}) {
  const webViewRef = useRef<WebView>(null);
  const requestedExportKeyRef = useRef<string | null>(null);

  useEffect(() => {
    requestedExportKeyRef.current = null;
  }, [job?.id]);

  const currentExportKey = job ? `${job.id}:0` : null;

  const handleLoadEnd = useCallback(() => {
    if (!currentExportKey || requestedExportKeyRef.current === currentExportKey) {
      return;
    }

    requestedExportKeyRef.current = currentExportKey;
    webViewRef.current?.injectJavaScript(RECEIPT_SHARE_EXPORT_WEBVIEW_SCRIPT);
  }, [currentExportKey]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!job || !currentExportKey) {
        return;
      }

      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) {
        return;
      }

      if (message.type === "receipt-export-error") {
        onError(new Error(message.payload));
        return;
      }

      void shareReceiptPngBase64(message.payload, job.dialogTitle)
        .then(() => onComplete())
        .catch((error) => {
          onError(error instanceof Error ? error : new Error(String(error)));
        });
    },
    [currentExportKey, job, onComplete, onError],
  );

  if (!job) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.hiddenBridge}>
      <WebView
        ref={webViewRef}
        key={job.id}
        originWhitelist={["*"]}
        source={{ html: job.html }}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        style={styles.hiddenWebView}
      />
    </View>
  );
}

export function useReceiptImageShare() {
  const [job, setJob] = useState<ReceiptShareJob | null>(null);
  const pendingPromiseRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const clearPendingJob = useCallback((error?: Error) => {
    const pending = pendingPromiseRef.current;
    pendingPromiseRef.current = null;
    setJob(null);

    if (!pending) {
      return;
    }

    if (error) {
      pending.reject(error);
      return;
    }

    pending.resolve();
  }, []);

  const startReceiptImageShare = useCallback(
    (html: string, dialogTitle: string) =>
      new Promise<void>((resolve, reject) => {
        const nextJobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        if (pendingPromiseRef.current) {
          pendingPromiseRef.current.reject(
            new Error("A new receipt share replaced the previous unfinished share."),
          );
        }

        pendingPromiseRef.current = { resolve, reject };
        setJob({
          id: nextJobId,
          html,
          dialogTitle,
        });
      }),
    [],
  );

  useEffect(
    () => () => {
      if (pendingPromiseRef.current) {
        pendingPromiseRef.current.reject(
          new Error("The receipt share was interrupted before it could finish."),
        );
        pendingPromiseRef.current = null;
      }
    },
    [],
  );

  const receiptImageShareBridge = useMemo(
    () => (
      <ReceiptImageShareBridge
        job={job}
        onComplete={() => clearPendingJob()}
        onError={(error) => clearPendingJob(error)}
      />
    ),
    [clearPendingJob, job],
  );

  return {
    receiptImageShareBridge,
    startReceiptImageShare,
  };
}

const styles = StyleSheet.create({
  hiddenBridge: {
    position: "absolute",
    left: -10000,
    top: 0,
    opacity: 0.01,
    width: 404,
    height: 1400,
  },
  hiddenWebView: {
    width: "100%",
    height: "100%",
    backgroundColor: "#ffffff",
  },
});
