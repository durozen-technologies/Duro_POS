import { AppState, NativeModules, PermissionsAndroid, Platform } from "react-native";
import {
  type IBLEPrinter,
  type IUSBPrinter,
  type PrinterImageOptions as NativePrinterImageOptions,
  type PrinterOptions as NativePrinterOptions,
} from "@haroldtran/react-native-thermal-printer";

import { getLocalizedItemName } from "@/hooks/use-shop-translation";
import { ShopLanguage } from "@/store/shop-language-store";
import { BillRead } from "@/types/api";
import {
  PrinterDevice,
  PrinterSupportState,
  PrinterTransport,
} from "@/types/printer";
import {
  formatCurrency,
  formatDateTime,
  formatUnit,
} from "@/utils/format";
import {
  DEFAULT_RECEIPT_PAPER_MM,
  getReceiptPaperProfile,
  type ReceiptPaperMm,
} from "@/utils/receipt-paper";

type ReceiptLineAlignment = "left" | "center";

type PrintableReceiptLine = {
  text: string;
  align?: ReceiptLineAlignment;
  bold?: boolean;
  doubleSize?: boolean;
};

type PrinterOptions = {
  beep?: boolean;
  cut?: boolean;
  tailingLine?: boolean;
  encoding?: string;
  settleDelayMs?: number;
  onError?: (error: Error) => void;
};

type PrinterRuntime = {
  init: () => Promise<void>;
  getDeviceList: () => Promise<PrinterDevice[]>;
  connect: (device: PrinterDevice) => Promise<void>;
  closeConn: () => Promise<void>;
  printBill: (text: string, options?: PrinterOptions) => Promise<void>;
  printImageBase64: (
    base64: string,
    options?: NativePrinterImageOptions & { settleDelayMs?: number },
  ) => Promise<void>;
};

type ReceiptImagePrintOptions = {
  imageWidth?: number;
};

type ImagePrintDispatchOptions = PrinterOptions & {
  settleDelayMs?: number;
};

type ActivePrinterSession = {
  deviceId: string;
  device: PrinterDevice;
  runtime: PrinterRuntime;
};

const IMAGE_SLICE_SETTLE_MS = 1800;
const IMAGE_LAST_SLICE_SETTLE_MS = 2000;
const DRAIN_FLOOR_MS = 1200;
const DRAIN_CAP_MS = 6000;
const DRAIN_BYTES_PER_SEC = 2500;
const SESSION_IDLE_DISCONNECT_MS = 15_000;
const ESC_INIT = "\x1B\x40";

const RECEIPT_COPY = {
  en: {
    receipt: "Receipt",
    bill: "Bill",
    date: "Date",
    cash: "Cash",
    upi: "UPI",
    total: "Total",
    thankYou: "THANK YOU. VISIT AGAIN.",
    poweredBy: "Powered by Durozen",
  },
  ta: {
    receipt: "ரசீது",
    bill: "பில்",
    date: "தேதி",
    cash: "பணம்",
    upi: "யூபிஐ",
    total: "மொத்தம்",
    thankYou: "நன்றி. மீண்டும் வருக.",
    poweredBy: "Durozen வழங்கியது",
  },
} as const;

function getReceiptLanguage() {
  return "ta" as const;
}

function getReceiptCopy(language: ShopLanguage) {
  return RECEIPT_COPY[language];
}

function formatReceiptShopName(shopName: string, language: ShopLanguage) {
  return language === "ta" ? shopName : shopName.toUpperCase();
}

function formatReceiptOrganizationName(organizationName: string, language: ShopLanguage) {
  return language === "ta" ? organizationName : organizationName.toUpperCase();
}

function getThermalPrinterModule() {
  return require("@haroldtran/react-native-thermal-printer") as {
    BLEPrinter: typeof import("@haroldtran/react-native-thermal-printer").BLEPrinter;
    USBPrinter: typeof import("@haroldtran/react-native-thermal-printer").USBPrinter;
    COMMANDS: typeof import("@haroldtran/react-native-thermal-printer").COMMANDS;
  };
}

function getCommandText(paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM) {
  const { COMMANDS } = getThermalPrinterModule();
  const profile = getReceiptPaperProfile(paperMm);

  return {
    CENTER: COMMANDS.TEXT_FORMAT.TXT_ALIGN_CT,
    LEFT: COMMANDS.TEXT_FORMAT.TXT_ALIGN_LT,
    BOLD_ON: COMMANDS.TEXT_FORMAT.TXT_BOLD_ON,
    BOLD_OFF: COMMANDS.TEXT_FORMAT.TXT_BOLD_OFF,
    DOUBLE_SIZE:
      COMMANDS.TEXT_FORMAT.TXT_2HEIGHT +
      COMMANDS.TEXT_FORMAT.TXT_2WIDTH,
    NORMAL: COMMANDS.TEXT_FORMAT.TXT_NORMAL,
    DIVIDER: COMMANDS.HORIZONTAL_LINE[profile.dividerKey],
  } as const;
}

function getAndroidApiLevel() {
  return typeof Platform.Version === "number"
    ? Platform.Version
    : Number(Platform.Version ?? 0);
}

function hasBluetoothModule() {
  return Boolean(NativeModules.RNBLEPrinter);
}

function hasUsbModule() {
  return Boolean(NativeModules.RNUSBPrinter);
}

async function requestBluetoothPermissions() {
  if (Platform.OS !== "android") {
    return true;
  }

  const apiLevel = getAndroidApiLevel();
  const permissions =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const statuses = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    (permission) =>
      statuses[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

function getTransportLabel(transport: PrinterTransport) {
  return transport === "bluetooth" ? "Bluetooth" : "USB";
}

export function getSavedPrinterLabel(device: PrinterDevice) {
  return `${getTransportLabel(device.transport)} - ${device.name}`;
}

export function getPrinterDeviceDetail(device: PrinterDevice) {
  return device.transport === "bluetooth"
    ? device.address ?? device.deviceName ?? device.name
    : `${device.vendorId ?? "?"}/${device.productId ?? "?"}`;
}

function wrapReceiptLine(value: string, width: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function padColumns(
  left: string,
  right: string,
  width = getReceiptPaperProfile(DEFAULT_RECEIPT_PAPER_MM).cols,
) {
  const safeLeft = left.trim();
  const safeRight = right.trim();
  const spacing = Math.max(
    1,
    width - safeLeft.length - safeRight.length,
  );

  if (safeLeft.length + safeRight.length + 1 <= width) {
    return `${safeLeft}${" ".repeat(spacing)}${safeRight}`;
  }

  return `${safeLeft}\n${" ".repeat(
    Math.max(0, width - safeRight.length),
  )}${safeRight}`;
}

function alignReceiptLine(
  value: string,
  align: ReceiptLineAlignment = "left",
  width = getReceiptPaperProfile(DEFAULT_RECEIPT_PAPER_MM).cols,
) {
  if (align !== "center" || value.length >= width) {
    return value;
  }

  const padding = Math.max(0, Math.floor((width - value.length) / 2));
  return `${" ".repeat(padding)}${value}`;
}

function buildPrintableReceiptLines(
  bill: BillRead,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
): PrintableReceiptLine[] {
  const language = getReceiptLanguage();
  const copy = getReceiptCopy(language);
  const cols = getReceiptPaperProfile(paperMm).cols;
  const divider = "-".repeat(cols);
  const nameWrapWidth = Math.max(12, Math.floor(cols * 0.56));

  const itemLines = bill.items.flatMap((item) => {
    const translatedItemName = getLocalizedItemName(
      language,
      item.item_name,
      item.item_tamil_name,
    );
    const wrappedName = wrapReceiptLine(translatedItemName, nameWrapWidth);
    const lines: PrintableReceiptLine[] = [
      {
        text: padColumns(
          wrappedName[0] ?? translatedItemName,
          formatCurrency(item.line_total),
          cols,
        ),
      },
      {
        text: `${item.quantity} ${formatUnit(item.unit)} x ${formatCurrency(
          item.price_per_unit,
        )}`,
      },
    ];

    wrappedName.slice(1).forEach((line) => {
      lines.push({ text: line });
    });

    lines.push({ text: "" });
    return lines;
  });

  return [
    {
      text: formatReceiptOrganizationName(bill.organization_name, language),
      align: "center",
      bold: true,
      doubleSize: true,
    },
    {
      text: formatReceiptShopName(bill.shop_name, language),
      align: "center",
      bold: true,
    },
    { text: `${copy.receipt}: ${bill.receipt.receipt_number}` },
    { text: `${copy.bill}: ${bill.bill_no}` },
    { text: `${copy.date}: ${formatDateTime(bill.created_at)}` },
    { text: divider },
    ...itemLines,
    { text: divider },
    { text: padColumns(copy.cash, formatCurrency(bill.payment.cash_amount), cols) },
    { text: padColumns(copy.upi, formatCurrency(bill.payment.upi_amount), cols) },
    {
      text: padColumns(copy.total, formatCurrency(bill.total_amount), cols),
      bold: true,
    },
    { text: divider },
    {
      text: copy.thankYou,
      align: "center",
      bold: true,
    },
    {
      text: copy.poweredBy,
      align: "center",
    },
    { text: "" },
  ];
}

function buildPrintableReceipt(
  bill: BillRead,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  const COMMAND_TEXT = getCommandText(paperMm);

  return buildPrintableReceiptLines(bill, paperMm)
    .map((line) => {
      const alignCommand =
        line.align === "center" ? COMMAND_TEXT.CENTER : COMMAND_TEXT.LEFT;
      const sizeCommand = line.doubleSize
        ? COMMAND_TEXT.DOUBLE_SIZE
        : COMMAND_TEXT.NORMAL;
      const weightCommand = line.bold
        ? COMMAND_TEXT.BOLD_ON
        : COMMAND_TEXT.BOLD_OFF;

      return `${alignCommand}${sizeCommand}${weightCommand}${line.text}${COMMAND_TEXT.BOLD_OFF}${COMMAND_TEXT.NORMAL}`;
    })
    .join("\n");
}

export function buildPrintableReceiptPreview(
  bill: BillRead,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  const cols = getReceiptPaperProfile(paperMm).cols;
  return buildPrintableReceiptLines(bill, paperMm)
    .map((line) => alignReceiptLine(line.text, line.align, cols))
    .join("\n");
}

function buildTestReceipt(
  device: PrinterDevice,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  const COMMAND_TEXT = getCommandText(paperMm);

  return [
    `${COMMAND_TEXT.CENTER}${COMMAND_TEXT.BOLD_ON}PRINTER LINKED${COMMAND_TEXT.BOLD_OFF}`,
    `${COMMAND_TEXT.LEFT}${getSavedPrinterLabel(device)}`,
    device.address ? `Address: ${device.address}` : "",
    device.vendorId && device.productId
      ? `USB: ${device.vendorId}/${device.productId}`
      : "",
    `Checked: ${formatDateTime(new Date().toISOString())}`,
    `Paper: ${paperMm}mm`,
    COMMAND_TEXT.DIVIDER,
    "Ready for live POS receipts.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getPrintOptions(
  options: PrinterOptions = {},
  onError?: (error: Error) => void,
): NativePrinterOptions {
  return {
    beep: options.beep ?? true,
    cut: options.cut ?? true,
    tailingLine: options.tailingLine ?? true,
    encoding: options.encoding ?? "UTF8",
    onError,
  };
}

function getPrintImageOptions(
  imageWidth: number,
  onError?: (error: Error) => void,
): NativePrinterImageOptions {
  return {
    beep: true,
    cut: true,
    tailingLine: true,
    encoding: "UTF8",
    imageWidth,
    align: "center",
    onError,
  };
}

function getPrintImageSliceOptions(
  index: number,
  total: number,
  imageWidth: number,
  onError?: (error: Error) => void,
): NativePrinterImageOptions {
  const isLastSlice = index === total - 1;

  return {
    ...getPrintImageOptions(imageWidth, onError),
    beep: isLastSlice,
    cut: isLastSlice,
    tailingLine: isLastSlice,
  };
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function isNoDeviceFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no device found");
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function estimateDecodedBytesFromBase64(chunks: string[]) {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return Math.max(1, Math.floor(totalChars * 0.75));
}

function computeImageDrainMs(base64Chunks: string[]) {
  const bytes = estimateDecodedBytesFromBase64(base64Chunks);
  const estimatedMs = Math.ceil((bytes / DRAIN_BYTES_PER_SEC) * 1000);
  return Math.max(DRAIN_FLOOR_MS, Math.min(DRAIN_CAP_MS, estimatedMs));
}

function waitForPrintDispatch(
  dispatch: (options: NativePrinterOptions) => void,
  options: PrinterOptions & { settleDelayMs?: number } = {},
  settleDelayMs = 400,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const { settleDelayMs: _settleDelayMs, onError, ...printOptions } = options;

    dispatch(
      getPrintOptions(printOptions, (error) => {
        if (settled) {
          return;
        }

        settled = true;
        onError?.(error);
        reject(toError(error));
      }),
    );

    setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    }, settleDelayMs);
  });
}

function waitForImagePrintDispatch(
  dispatch: (options: NativePrinterOptions) => void,
  options: ImagePrintDispatchOptions = {},
  settleDelayMs = 900,
) {
  // Image printing takes longer than text on many thermal drivers.
  // Multi-slice jobs need extra settle time between chunks as a library fallback.
  return waitForPrintDispatch(dispatch, options, settleDelayMs);
}

function normalizeBluetoothPrinter(printer: IBLEPrinter): PrinterDevice {
  return {
    id: `bluetooth:${printer.inner_mac_address}`,
    transport: "bluetooth",
    name: printer.device_name?.trim() || "Bluetooth Printer",
    address: printer.inner_mac_address,
    deviceName: printer.device_name,
  };
}

function normalizeUsbPrinter(printer: IUSBPrinter): PrinterDevice {
  const displayName =
    printer.product_name?.trim() ||
    printer.manufacturer_name?.trim() ||
    printer.device_name?.trim() ||
    "USB Printer";

  return {
    id: `usb:${printer.vendor_id}:${printer.product_id}:${printer.device_name}`,
    transport: "usb",
    name: displayName,
    vendorId: printer.vendor_id,
    productId: printer.product_id,
    deviceName: printer.device_name,
    manufacturerName: printer.manufacturer_name,
    productName: printer.product_name,
  };
}

function dedupePrinters(devices: PrinterDevice[]) {
  const registry = new Map<string, PrinterDevice>();

  devices.forEach((device) => {
    registry.set(device.id, device);
  });

  return [...registry.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function createBluetoothRuntime(): PrinterRuntime {
  if (!hasBluetoothModule()) {
    throw new Error(
      "Bluetooth printer support needs an Android development build or release build.",
    );
  }

  const { BLEPrinter } = getThermalPrinterModule();

  return {
    init: () => BLEPrinter.init(),
    getDeviceList: async () => {
      try {
        const printers = await BLEPrinter.getDeviceList();
        return dedupePrinters(printers.map(normalizeBluetoothPrinter));
      } catch (error) {
        if (isNoDeviceFound(error)) {
          return [];
        }

        throw toError(error);
      }
    },
    connect: async (device) => {
      if (!device.address) {
        throw new Error(
          "This Bluetooth printer is missing its device address.",
        );
      }

      await BLEPrinter.connectPrinter(device.address);
    },
    closeConn: () => BLEPrinter.closeConn(),
    printBill: (text, options = {}) => {
      const settleDelayMs = options.settleDelayMs ?? 400;
      return waitForPrintDispatch(
        (nativeOptions) => BLEPrinter.printBill(text, nativeOptions),
        options,
        settleDelayMs,
      );
    },
    printImageBase64: (base64, options = {}) => {
      const settleDelayMs = options.settleDelayMs ?? 900;
      const { settleDelayMs: _settleDelayMs, ...imageOptions } = options;
      return waitForImagePrintDispatch(
        (nativeOptions) =>
          BLEPrinter.printImageBase64(base64, {
            ...getPrintImageOptions(
              imageOptions.imageWidth ??
                getReceiptPaperProfile(DEFAULT_RECEIPT_PAPER_MM).imageWidth,
              nativeOptions.onError,
            ),
            ...imageOptions,
          }),
        options,
        settleDelayMs,
      );
    },
  };
}

function createUsbRuntime(): PrinterRuntime {
  if (!hasUsbModule()) {
    throw new Error(
      "USB printer support needs an Android development build or release build.",
    );
  }

  const { USBPrinter } = getThermalPrinterModule();

  return {
    init: () => USBPrinter.init(),
    getDeviceList: async () => {
      try {
        const printers = await USBPrinter.getDeviceList();
        return dedupePrinters(printers.map(normalizeUsbPrinter));
      } catch (error) {
        if (isNoDeviceFound(error)) {
          return [];
        }

        throw toError(error);
      }
    },
    connect: async (device) => {
      if (!device.vendorId || !device.productId) {
        throw new Error(
          "This USB printer is missing its vendor or product id.",
        );
      }

      await USBPrinter.connectPrinter(device.vendorId, device.productId);
    },
    closeConn: () => USBPrinter.closeConn(),
    printBill: (text, options = {}) => {
      const settleDelayMs = options.settleDelayMs ?? 400;
      return waitForPrintDispatch(
        (nativeOptions) => USBPrinter.printBill(text, nativeOptions),
        options,
        settleDelayMs,
      );
    },
    printImageBase64: (base64, options = {}) => {
      const settleDelayMs = options.settleDelayMs ?? 900;
      const { settleDelayMs: _settleDelayMs, ...imageOptions } = options;
      return waitForImagePrintDispatch(
        (nativeOptions) =>
          USBPrinter.printImageBase64(base64, {
            ...getPrintImageOptions(
              imageOptions.imageWidth ??
                getReceiptPaperProfile(DEFAULT_RECEIPT_PAPER_MM).imageWidth,
              nativeOptions.onError,
            ),
            ...imageOptions,
          }),
        options,
        settleDelayMs,
      );
    },
  };
}

async function ensureBluetoothPrinterReady() {
  if (Platform.OS !== "android") {
    throw new Error(
      "Bluetooth receipt printing is currently available only on Android.",
    );
  }

  if (!hasBluetoothModule()) {
    throw new Error(
      "Bluetooth printer support needs an Android development build or release build.",
    );
  }

  const permissionGranted = await requestBluetoothPermissions();
  if (!permissionGranted) {
    throw new Error(
      "Bluetooth permissions were denied. Allow printer permissions and try again.",
    );
  }

  const runtime = createBluetoothRuntime();
  await runtime.init();
  return runtime;
}

async function ensureUsbPrinterReady() {
  if (Platform.OS !== "android") {
    throw new Error(
      "USB receipt printing is currently available only on Android.",
    );
  }

  if (!hasUsbModule()) {
    throw new Error(
      "USB printer support needs an Android development build or release build.",
    );
  }

  const runtime = createUsbRuntime();
  await runtime.init();
  return runtime;
}

async function getPrinterRuntime(device: PrinterDevice) {
  if (device.transport === "bluetooth") {
    return ensureBluetoothPrinterReady();
  }

  return ensureUsbPrinterReady();
}

async function closePrinterConnection(printer: PrinterRuntime) {
  try {
    await printer.closeConn();
  } catch {
    // Some devices throw here when no session is open, which is safe to ignore.
  }
}

async function connectWithRetry(
  printer: PrinterRuntime,
  device: PrinterDevice,
) {
  try {
    await printer.connect(device);
  } catch (error) {
    await closePrinterConnection(printer);

    try {
      await printer.connect(device);
    } catch {
      throw toError(error);
    }
  }
}

let printerJobQueue: Promise<unknown> = Promise.resolve();
let activeSession: ActivePrinterSession | null = null;
let idleDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDrainMs = 0;
let appStateSubscription: { remove: () => void } | null = null;

function clearIdleDisconnectTimer() {
  if (idleDisconnectTimer) {
    clearTimeout(idleDisconnectTimer);
    idleDisconnectTimer = null;
  }
}

function enqueuePrinterJob<T>(job: () => Promise<T>): Promise<T> {
  const run = printerJobQueue.then(job, job);
  printerJobQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function disconnectActiveSession() {
  clearIdleDisconnectTimer();
  const session = activeSession;
  activeSession = null;
  pendingDrainMs = 0;
  if (!session) {
    return;
  }
  await closePrinterConnection(session.runtime);
}

function scheduleIdleDisconnect() {
  clearIdleDisconnectTimer();
  idleDisconnectTimer = setTimeout(() => {
    void enqueuePrinterJob(async () => {
      if (pendingDrainMs > 0) {
        await delay(pendingDrainMs);
        pendingDrainMs = 0;
      }
      await disconnectActiveSession();
    });
  }, SESSION_IDLE_DISCONNECT_MS);
}

function ensureAppStateDisconnectListener() {
  if (appStateSubscription || Platform.OS === "web") {
    return;
  }

  appStateSubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState === "background" || nextState === "inactive") {
      void enqueuePrinterJob(async () => {
        if (pendingDrainMs > 0) {
          await delay(pendingDrainMs);
          pendingDrainMs = 0;
        }
        await disconnectActiveSession();
      });
    }
  });
}

async function acquirePrinterSession(device: PrinterDevice): Promise<PrinterRuntime> {
  ensureAppStateDisconnectListener();
  clearIdleDisconnectTimer();

  if (activeSession && activeSession.deviceId === device.id) {
    return activeSession.runtime;
  }

  if (activeSession) {
    if (pendingDrainMs > 0) {
      await delay(pendingDrainMs);
      pendingDrainMs = 0;
    }
    await disconnectActiveSession();
  }

  const runtime = await getPrinterRuntime(device);
  await connectWithRetry(runtime, device);
  activeSession = {
    deviceId: device.id,
    device,
    runtime,
  };
  return runtime;
}

function releasePrinterSession(options?: { drainMs?: number }) {
  if (typeof options?.drainMs === "number" && options.drainMs > 0) {
    pendingDrainMs = Math.max(pendingDrainMs, options.drainMs);
  }
  scheduleIdleDisconnect();
}

async function withPrinterSession<T>(
  device: PrinterDevice,
  run: (printer: PrinterRuntime) => Promise<T>,
  options?: { drainMs?: number },
): Promise<T> {
  return enqueuePrinterJob(async () => {
    if (pendingDrainMs > 0 && activeSession?.deviceId === device.id) {
      await delay(pendingDrainMs);
      pendingDrainMs = 0;
    }

    const printer = await acquirePrinterSession(device);
    try {
      return await run(printer);
    } finally {
      releasePrinterSession({ drainMs: options?.drainMs });
    }
  });
}

export function getPrinterSupportState(): PrinterSupportState {
  if (Platform.OS !== "android") {
    return {
      supported: false,
      bluetooth: false,
      usb: false,
      reason:
        "Direct Bluetooth and USB thermal printing are currently available only on Android.",
    };
  }

  const bluetooth = hasBluetoothModule();
  const usb = hasUsbModule();

  if (!bluetooth && !usb) {
    return {
      supported: false,
      bluetooth: false,
      usb: false,
      reason:
        "Printer support needs an Android development build or release build. Expo Go cannot load these native printer modules.",
    };
  }

  return {
    supported: true,
    bluetooth,
    usb,
  };
}

export async function loadBluetoothPrinters() {
  const printer = await ensureBluetoothPrinterReady();
  return printer.getDeviceList();
}

export async function loadUsbPrinters() {
  const printer = await ensureUsbPrinterReady();
  return printer.getDeviceList();
}

export async function connectPrinterDevice(device: PrinterDevice) {
  await withPrinterSession(device, async () => undefined);
  return device;
}

export async function printTestReceipt(
  device: PrinterDevice,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  await withPrinterSession(device, async (printer) => {
    await printer.printBill(buildTestReceipt(device, paperMm));
  }, { drainMs: DRAIN_FLOOR_MS });
}

export async function printBillWithPrinter(
  bill: BillRead,
  device: PrinterDevice,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  await withPrinterSession(device, async (printer) => {
    await printer.printBill(buildPrintableReceipt(bill, paperMm));
  }, { drainMs: DRAIN_FLOOR_MS });
}

export async function printReceiptImageBase64WithPrinter(
  base64Chunks: string[],
  device: PrinterDevice,
  options?: ReceiptImagePrintOptions,
) {
  if (base64Chunks.length === 0) {
    return;
  }

  const imageWidth =
    options?.imageWidth ?? getReceiptPaperProfile(DEFAULT_RECEIPT_PAPER_MM).imageWidth;
  const drainMs = computeImageDrainMs(base64Chunks);

  await withPrinterSession(
    device,
    async (printer) => {
      const chunkCount = base64Chunks.length;
      for (let index = 0; index < chunkCount; index += 1) {
        const base64Chunk = base64Chunks[index];
        const isLastSlice = index === chunkCount - 1;
        const settleDelayMs = isLastSlice
          ? IMAGE_LAST_SLICE_SETTLE_MS
          : IMAGE_SLICE_SETTLE_MS;
        await printer.printImageBase64(base64Chunk, {
          ...getPrintImageSliceOptions(index, chunkCount, imageWidth),
          settleDelayMs,
        });
      }

      // Optional format reset only — does not replace drain/session reuse.
      try {
        await printer.printBill(ESC_INIT, {
          beep: false,
          cut: false,
          tailingLine: false,
          settleDelayMs: 300,
        });
      } catch {
        // Some firmwares reject bare ESC @; ignore and rely on drain/session.
      }
    },
    { drainMs },
  );
}

export async function printBillsWithPrinter(
  bills: BillRead[],
  device: PrinterDevice,
  paperMm: ReceiptPaperMm = DEFAULT_RECEIPT_PAPER_MM,
) {
  if (bills.length === 0) {
    return;
  }

  await withPrinterSession(device, async (printer) => {
    for (const bill of bills) {
      await printer.printBill(buildPrintableReceipt(bill, paperMm));
    }
  }, { drainMs: DRAIN_FLOOR_MS });
}
