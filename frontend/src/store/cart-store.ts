import { create } from "zustand";

import { BaseUnit, UnitType, UUID } from "@/types/api";
import { money, quantityFromAmount, toMoneyString } from "@/utils/decimal";

export type CartItem = {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  base_unit: BaseUnit;
  unit_type: UnitType;
  price_per_unit: string;
  quantity: string;
  line_total: string;
};

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateQuantity: (itemId: UUID, quantity: string) => void;
  removeItem: (itemId: UUID) => void;
  resetCart: () => void;
};

function mergeCartLine(existing: CartItem, incoming: CartItem): CartItem {
  const combinedTotal = money(existing.line_total).plus(money(incoming.line_total));
  const isUnit = existing.base_unit === BaseUnit.UNIT;
  const quantity = quantityFromAmount(
    combinedTotal.toString(),
    existing.price_per_unit,
    isUnit,
  );
  return {
    ...existing,
    line_total: toMoneyString(combinedTotal.toFixed(2)),
    quantity,
  };
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((line) => line.item_id === item.item_id);
      if (!existing) {
        return { items: [...state.items, item] };
      }

      return {
        items: state.items.map((line) =>
          line.item_id === item.item_id ? mergeCartLine(line, item) : line,
        ),
      };
    }),
  updateQuantity: (itemId, quantity) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.item_id !== itemId) {
          return item;
        }
        const line_total = toMoneyString(
          money(item.price_per_unit).mul(money(quantity)).toFixed(2),
        );
        return { ...item, quantity, line_total };
      }),
    })),
  removeItem: (itemId) =>
    set((state) => ({ items: state.items.filter((item) => item.item_id !== itemId) })),
  resetCart: () =>
    set((state) => (state.items.length === 0 ? state : { items: [] })),
}));

export function getCartTotal(items: CartItem[]) {
  return items
    .reduce((total, item) => total.plus(money(item.line_total)), money(0))
    .toFixed(2);
}
