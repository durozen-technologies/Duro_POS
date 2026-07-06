import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { PRINTER_STORAGE_KEY } from "@/constants/config";
import { PrinterDevice } from "@/types/printer";
import { secureStorage } from "@/utils/secure-storage";

type PrinterState = {
  preferredPrinter: PrinterDevice | null;
  setPreferredPrinter: (printer: PrinterDevice) => void;
  clearPreferredPrinter: () => void;
};

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      preferredPrinter: null,
      setPreferredPrinter: (preferredPrinter) => set({ preferredPrinter }),
      clearPreferredPrinter: () => set({ preferredPrinter: null }),
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
