import { create } from "zustand";

import { BaseUnit, UnitType, UUID } from "@/types/api";
import { money } from "@/utils/decimal";

export type RetailerCartItem = {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  base_unit: BaseUnit;
  unit_type: UnitType;
  price_per_unit: string;
  quantity: string;
};

type RetailerCartState = {
  retailerId: UUID | null;
  retailerName: string | null;
  items: RetailerCartItem[];
  setRetailer: (retailerId: UUID, retailerName: string) => void;
  addItem: (item: RetailerCartItem) => void;
  updateQuantity: (itemId: UUID, quantity: string) => void;
  removeItem: (itemId: UUID) => void;
  resetCart: () => void;
};

export const useRetailerCartStore = create<RetailerCartState>((set) => ({
  retailerId: null,
  retailerName: null,
  items: [],
  setRetailer: (retailerId, retailerName) =>
    set({ retailerId, retailerName, items: [] }),
  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((line) => line.item_id === item.item_id);
      if (!existing) {
        return { items: [...state.items, item] };
      }
      return {
        items: state.items.map((line) =>
          line.item_id === item.item_id
            ? {
                ...line,
                quantity: money(line.quantity).plus(money(item.quantity)).toString(),
              }
            : line,
        ),
      };
    }),
  updateQuantity: (itemId, quantity) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.item_id === itemId ? { ...item, quantity } : item,
      ),
    })),
  removeItem: (itemId) =>
    set((state) => ({
      items: state.items.filter((item) => item.item_id !== itemId),
    })),
  resetCart: () =>
    set((state) =>
      state.items.length === 0 && !state.retailerId
        ? state
        : { retailerId: null, retailerName: null, items: [] },
    ),
}));

export function getRetailerCartTotal(items: RetailerCartItem[]) {
  return items
    .reduce(
      (total, item) => total.plus(money(item.price_per_unit).mul(money(item.quantity))),
      money(0),
    )
    .toFixed(2);
}
