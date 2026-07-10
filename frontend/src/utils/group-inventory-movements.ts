import {
  InventoryMovementType,
  BaseUnit,
  type InventoryMovementRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";

export type GroupedMovementCategoryLine = {
  category_id: UUID | null;
  category_name: string | null;
  quantity: string;
  bird_count: number;
};

export type GroupedInventoryMovement = {
  key: string;
  inventory_item_id: UUID;
  inventory_item_name: string;
  inventory_item_tamil_name?: string | null;
  movement_type: InventoryMovementType;
  unit: BaseUnit;
  occurred_at: string;
  created_at: string;
  driver_name?: string | null;
  vehicle_number?: string | null;
  total_quantity: string;
  total_bird_count: number;
  categories: GroupedMovementCategoryLine[];
};

/** ponytail: groups by item + type + occurred_at + created_at second; upgrade path is backend operation_id */
function movementGroupKey(movement: InventoryMovementRead): string {
  const createdSecond = movement.created_at.slice(0, 19);
  return `${movement.inventory_item_id}|${movement.movement_type}|${movement.occurred_at}|${createdSecond}`;
}

function movementTextFieldValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickMovementTextField(
  rows: InventoryMovementRead[],
  field: "driver_name" | "vehicle_number",
): string | null {
  let best: string | null = null;
  for (const row of rows) {
    const value = movementTextFieldValue(row[field]);
    if (!value) {
      continue;
    }
    if (!best || value.length > best.length) {
      best = value;
    }
  }
  return best;
}

export function groupInventoryMovements(movements: InventoryMovementRead[]): GroupedInventoryMovement[] {
  const buckets = new Map<string, InventoryMovementRead[]>();
  for (const movement of movements) {
    const key = movementGroupKey(movement);
    const rows = buckets.get(key) ?? [];
    rows.push(movement);
    buckets.set(key, rows);
  }

  const grouped = Array.from(buckets.entries()).map(([key, rows]) => {
    const head = rows[0];
    const total = rows.reduce((sum, row) => sum.add(money(row.quantity)), money(0));
    const totalBirdCount = rows.reduce((sum, row) => sum + (row.bird_count ?? 0), 0);
    const categories =
      head.movement_type === InventoryMovementType.USE
        ? rows
            .filter((row) => row.category_id || row.category_name)
            .map((row) => ({
              category_id: row.category_id ?? null,
              category_name: row.category_name ?? null,
              quantity: row.quantity,
              bird_count: row.bird_count ?? 0,
            }))
            .sort((left, right) => (left.category_name ?? "").localeCompare(right.category_name ?? ""))
        : [];

    return {
      key,
      inventory_item_id: head.inventory_item_id,
      inventory_item_name: head.inventory_item_name,
      inventory_item_tamil_name: head.inventory_item_tamil_name,
      movement_type: head.movement_type,
      unit: head.unit,
      occurred_at: head.occurred_at,
      created_at: head.created_at,
      driver_name: pickMovementTextField(rows, "driver_name"),
      vehicle_number: pickMovementTextField(rows, "vehicle_number"),
      total_quantity: total.toString(),
      total_bird_count: totalBirdCount,
      categories,
    };
  });

  return grouped.sort((left, right) => {
    const occurredDelta = new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime();
    if (occurredDelta !== 0) {
      return occurredDelta;
    }
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

if (__DEV__) {
  const sample: InventoryMovementRead[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      shop_id: "00000000-0000-4000-8000-000000000099",
      inventory_item_id: "00000000-0000-4000-8000-000000000010",
      inventory_item_name: "Chicken",
      movement_type: InventoryMovementType.USE,
      category_id: "00000000-0000-4000-8000-000000000020",
      category_name: "Retail",
      quantity: "2",
      bird_count: 1,
      unit: BaseUnit.KG,
      occurred_at: "2026-06-29T10:00:00.000Z",
      created_at: "2026-06-29T10:00:01.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      shop_id: "00000000-0000-4000-8000-000000000099",
      inventory_item_id: "00000000-0000-4000-8000-000000000010",
      inventory_item_name: "Chicken",
      movement_type: InventoryMovementType.USE,
      category_id: "00000000-0000-4000-8000-000000000021",
      category_name: "Wholesale",
      quantity: "3",
      bird_count: 2,
      unit: BaseUnit.KG,
      occurred_at: "2026-06-29T10:00:00.000Z",
      created_at: "2026-06-29T10:00:01.000Z",
    },
  ];
  const grouped = groupInventoryMovements(sample);
  console.assert(grouped.length === 1, "split use should group to one operation");
  console.assert(money(grouped[0]?.total_quantity ?? "0").toNumber() === 5, "split use should sum quantities");
}
