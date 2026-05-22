import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import {
  type IBLEPrinter,
  type IUSBPrinter,
  type PrinterImageOptions as NativePrinterImageOptions,
  type PrinterOptions as NativePrinterOptions,
} from "@haroldtran/react-native-thermal-printer";

import { translateShopItemName } from "@/hooks/use-shop-translation";
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

const PAPER_WIDTH_58 = 32;

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
  onError?: (error: Error) => void;
};

type PrinterRuntime = {
  init: () => Promise<void>;
  getDeviceList: () => Promise<PrinterDevice[]>;
  connect: (device: PrinterDevice) => Promise<void>;
  closeConn: () => Promise<void>;
  printBill: (text: string, options?: PrinterOptions) => Promise<void>;
  printImageBase64: (base64: string, options?: NativePrinterImageOptions) => Promise<void>;
};

const RECEIPT_IMAGE_WIDTH = 380;

const RECEIPT_COPY = {
  en: {
    companyName: "SRI MAHALAKSHMI BROILERS",
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
    companyName: "ஸ்ரீ மகாலட்சுமி பிராய்லர்ஸ்",
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

function getThermalPrinterModule() {
  return require("@haroldtran/react-native-thermal-printer") as {
    BLEPrinter: typeof import("@haroldtran/react-native-thermal-printer").BLEPrinter;
    USBPrinter: typeof import("@haroldtran/react-native-thermal-printer").USBPrinter;
    COMMANDS: typeof import("@haroldtran/react-native-thermal-printer").COMMANDS;
  };
}

function getCommandText() {
  const { COMMANDS } = getThermalPrinterModule();

  return {
    CENTER: COMMANDS.TEXT_FORMAT.TXT_ALIGN_CT,
    LEFT: COMMANDS.TEXT_FORMAT.TXT_ALIGN_LT,
    BOLD_ON: COMMANDS.TEXT_FORMAT.TXT_BOLD_ON,
    BOLD_OFF: COMMANDS.TEXT_FORMAT.TXT_BOLD_OFF,
    DOUBLE_SIZE:
      COMMANDS.TEXT_FORMAT.TXT_2HEIGHT +
      COMMANDS.TEXT_FORMAT.TXT_2WIDTH,
    NORMAL: COMMANDS.TEXT_FORMAT.TXT_NORMAL,
    DIVIDER: COMMANDS.HORIZONTAL_LINE.HR3_58MM,
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

function padColumns(left: string, right: string, width = PAPER_WIDTH_58) {
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
  width = PAPER_WIDTH_58,
) {
  if (align !== "center" || value.length >= width) {
    return value;
  }

  const padding = Math.max(0, Math.floor((width - value.length) / 2));
  return `${" ".repeat(padding)}${value}`;
}

function buildPrintableReceiptLines(bill: BillRead): PrintableReceiptLine[] {
  const language = getReceiptLanguage();
  const copy = getReceiptCopy(language);
  const divider = "-".repeat(PAPER_WIDTH_58);

  const itemLines = bill.items.flatMap((item) => {
    const translatedItemName = translateShopItemName(
      language,
      item.item_name,
    );
    const wrappedName = wrapReceiptLine(translatedItemName, 18);
    const lines: PrintableReceiptLine[] = [
      {
        text: padColumns(
          wrappedName[0] ?? translatedItemName,
          formatCurrency(item.line_total),
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
      text: copy.companyName,
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
    { text: padColumns(copy.cash, formatCurrency(bill.payment.cash_amount)) },
    { text: padColumns(copy.upi, formatCurrency(bill.payment.upi_amount)) },
    {
      text: padColumns(copy.total, formatCurrency(bill.total_amount)),
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

function buildPrintableReceipt(bill: BillRead) {
  const COMMAND_TEXT = getCommandText();

  return buildPrintableReceiptLines(bill)
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

export function buildPrintableReceiptPreview(bill: BillRead) {
  return buildPrintableReceiptLines(bill)
    .map((line) => alignReceiptLine(line.text, line.align))
    .join("\n");
}

function buildTestReceipt(device: PrinterDevice) {
  const COMMAND_TEXT = getCommandText();

  return [
    `${COMMAND_TEXT.CENTER}${COMMAND_TEXT.BOLD_ON}PRINTER LINKED${COMMAND_TEXT.BOLD_OFF}`,
    `${COMMAND_TEXT.LEFT}${getSavedPrinterLabel(device)}`,
    device.address ? `Address: ${device.address}` : "",
    device.vendorId && device.productId
      ? `USB: ${device.vendorId}/${device.productId}`
      : "",
    `Checked: ${formatDateTime(new Date().toISOString())}`,
    COMMAND_TEXT.DIVIDER,
    "Ready for live POS receipts.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getPrintOptions(onError?: (error: Error) => void): NativePrinterOptions {
  return {
    beep: true,
    cut: true,
    tailingLine: true,
    encoding: "UTF8",
    onError,
  };
}

function getPrintImageOptions(onError?: (error: Error) => void): NativePrinterImageOptions {
  return {
    beep: true,
    cut: true,
    tailingLine: true,
    encoding: "UTF8",
    imageWidth: RECEIPT_IMAGE_WIDTH,
    align: "center",
    onError,
  };
}

function getPrintImageSliceOptions(
  index: number,
  total: number,
  onError?: (error: Error) => void,
): NativePrinterImageOptions {
  const isLastSlice = index === total - 1;

  return {
    ...getPrintImageOptions(onError),
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

function waitForPrintDispatch(
  dispatch: (options: NativePrinterOptions) => void,
  options: PrinterOptions = {},
  settleDelayMs = 400,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    dispatch(
      getPrintOptions((error) => {
        if (settled) {
          return;
        }

        settled = true;
        options.onError?.(error);
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
  options: PrinterOptions = {},
) {
  // Image printing takes longer than text on many thermal drivers.
  return waitForPrintDispatch(dispatch, options, 900);
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
    printBill: (text, options = {}) =>
      waitForPrintDispatch(
        (nativeOptions) => BLEPrinter.printBill(text, nativeOptions),
        options,
      ),
    printImageBase64: (base64, options = {}) =>
      waitForImagePrintDispatch(
        (nativeOptions) =>
          BLEPrinter.printImageBase64(base64, {
            ...getPrintImageOptions(nativeOptions.onError),
            ...options,
          }),
        options,
      ),
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
    printBill: (text, options = {}) =>
      waitForPrintDispatch(
        (nativeOptions) => USBPrinter.printBill(text, nativeOptions),
        options,
      ),
    printImageBase64: (base64, options = {}) =>
      waitForImagePrintDispatch(
        (nativeOptions) =>
          USBPrinter.printImageBase64(base64, {
            ...getPrintImageOptions(nativeOptions.onError),
            ...options,
          }),
        options,
      ),
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

async function withPrinterConnection<T>(
  device: PrinterDevice,
  run: (printer: PrinterRuntime) => Promise<T>,
) {
  const printer = await getPrinterRuntime(device);

  await closePrinterConnection(printer);
  await connectWithRetry(printer, device);

  try {
    return await run(printer);
  } finally {
    await closePrinterConnection(printer);
  }
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
  await withPrinterConnection(device, async () => undefined);
  return device;
}

export async function printTestReceipt(device: PrinterDevice) {
  await withPrinterConnection(device, async (printer) => {
    await printer.printBill(buildTestReceipt(device));
  });
}

export async function printBillWithPrinter(
  bill: BillRead,
  device: PrinterDevice,
) {
  await withPrinterConnection(device, async (printer) => {
    await printer.printBill(buildPrintableReceipt(bill));
  });
}

export async function printReceiptImageBase64WithPrinter(
  base64Chunks: string[],
  device: PrinterDevice,
) {
  if (base64Chunks.length === 0) {
    return;
  }

  await withPrinterConnection(device, async (printer) => {
    for (let index = 0; index < base64Chunks.length; index += 1) {
      const base64Chunk = base64Chunks[index];
      await printer.printImageBase64(
        base64Chunk,
        getPrintImageSliceOptions(index, base64Chunks.length),
      );
    }
  });
}

export async function printBillsWithPrinter(
  bills: BillRead[],
  device: PrinterDevice,
) {
  if (bills.length === 0) {
    return;
  }

  await withPrinterConnection(device, async (printer) => {
    for (const bill of bills) {
      await printer.printBill(buildPrintableReceipt(bill));
    }
  });
}
