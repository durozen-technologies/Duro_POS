import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { PRINTER_STORAGE_KEY } from "@/constants/config";
import { PrinterDevice } from "@/types/printer";
import { secureStorage } from "@/utils/secure-storage";

export type PrinterConnectionStatus = "idle" | "ready" | "failed";

type PrinterState = {
  preferredPrinter: PrinterDevice | null;
  /** Session-only: saved printer must not imply Ready across app restarts. */
  connectionStatus: PrinterConnectionStatus;
  setPreferredPrinter: (printer: PrinterDevice) => void;
  setConnectionStatus: (status: PrinterConnectionStatus) => void;
  clearPreferredPrinter: () => void;
};

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      preferredPrinter: null,
      connectionStatus: "idle",
      setPreferredPrinter: (preferredPrinter) => set({ preferredPrinter }),
      setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
      clearPreferredPrinter: () => set({ preferredPrinter: null, connectionStatus: "idle" }),
    }),
    {
      name: PRINTER_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ preferredPrinter: state.preferredPrinter }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<PrinterState, "preferredPrinter">>;
        return { preferredPrinter: state.preferredPrinter ?? null };
      },
    },
  ),
);
