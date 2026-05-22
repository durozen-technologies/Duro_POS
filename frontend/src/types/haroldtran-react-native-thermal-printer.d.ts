declare module "@haroldtran/react-native-thermal-printer" {
  export type PrinterOptions = {
    beep?: boolean;
    cut?: boolean;
    tailingLine?: boolean;
    encoding?: string;
    onError?: (error: Error) => void;
  };

  export type PrinterImageOptions = PrinterOptions & {
    imageWidth?: number;
    align?: "left" | "center" | "right";
    paddingX?: number;
  };

  export type IBLEPrinter = {
    device: unknown;
    device_name: string;
    inner_mac_address: string;
  };

  export type IUSBPrinter = {
    device: unknown;
    manufacturer_name: string;
    product_name: string;
    device_name: string;
    vendor_id: string;
    product_id: string;
  };

  export const COMMANDS: {
    TEXT_FORMAT: {
      TXT_ALIGN_CT: string;
      TXT_ALIGN_LT: string;
      TXT_BOLD_ON: string;
      TXT_BOLD_OFF: string;
      TXT_2HEIGHT: string;
      TXT_2WIDTH: string;
      TXT_NORMAL: string;
    };
    HORIZONTAL_LINE: {
      HR3_58MM: string;
    };
  };

  export const BLEPrinter: {
    init: () => Promise<void>;
    getDeviceList: () => Promise<IBLEPrinter[]>;
    connectPrinter: (inner_mac_address: string) => Promise<IBLEPrinter>;
    closeConn: () => Promise<void>;
    printBill: (text: string, opts?: PrinterOptions) => void;
    printImageBase64: (base64: string, opts?: PrinterImageOptions) => void;
  };

  export const USBPrinter: {
    init: () => Promise<void>;
    getDeviceList: () => Promise<IUSBPrinter[]>;
    connectPrinter: (vendorId: string, productId: string) => Promise<IUSBPrinter>;
    closeConn: () => Promise<void>;
    printBill: (text: string, opts?: PrinterOptions) => void;
    printImageBase64: (base64: string, opts?: PrinterImageOptions) => void;
  };
}
