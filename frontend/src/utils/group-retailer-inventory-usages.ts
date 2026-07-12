import { BaseUnit, type RetailerInventoryUsageRead, type UUID } from "@/types/api";
import { money } from "@/utils/decimal";

export type GroupedRetailerCategoryLine = {
  category_id: UUID | null;
  category_name: string | null;
  quantity: string;
};

export type GroupedRetailerInventoryUsage = {
  key: string;
  inventory_item_id: UUID;
  inventory_item_name: string;
  inventory_item_tamil_name?: string | null;
  retailer_id?: UUID | null;
  retailer_name?: string | null;
  shop_name?: string | null;
  unit: BaseUnit;
  occurred_at: string;
  created_at: string;
  created_by_name?: string | null;
  adjustment_reason?: string | null;
  total_quantity: string;
  total_bird_count: number;
  categories: GroupedRetailerCategoryLine[];
};

/** ponytail: groups by item + retailer + occurred_at + created_at second; upgrade path is backend operation_id */
function retailerUsageGroupKey(usage: RetailerInventoryUsageRead): string {
  const createdSecond = usage.created_at.slice(0, 19);
  return `${usage.inventory_item_id}|${usage.retailer_id ?? "none"}|${usage.occurred_at}|${createdSecond}`;
}

export function groupRetailerInventoryUsages(
  usages: RetailerInventoryUsageRead[],
): GroupedRetailerInventoryUsage[] {
  const buckets = new Map<string, RetailerInventoryUsageRead[]>();
  for (const usage of usages) {
    const key = retailerUsageGroupKey(usage);
    const rows = buckets.get(key) ?? [];
    rows.push(usage);
    buckets.set(key, rows);
  }

  const grouped = Array.from(buckets.entries()).map(([key, rows]) => {
    const head = rows[0];
    const total = rows.reduce((sum, row) => sum.add(money(row.quantity)), money(0));
    const totalBirdCount = rows.reduce((sum, row) => sum + (row.bird_count ?? 0), 0);
    const categories = rows
      .filter((row) => row.category_id || row.category_name)
      .map((row) => ({
        category_id: row.category_id ?? null,
        category_name: row.category_name ?? null,
        quantity: row.quantity,
      }))
      .sort((left, right) => (left.category_name ?? "").localeCompare(right.category_name ?? ""));

    return {
      key,
      inventory_item_id: head.inventory_item_id,
      inventory_item_name: head.inventory_item_name,
      inventory_item_tamil_name: head.inventory_item_tamil_name,
      retailer_id: head.retailer_id,
      retailer_name: head.retailer_name,
      shop_name: head.shop_name,
      unit: head.unit,
      occurred_at: head.occurred_at,
      created_at: head.created_at,
      created_by_name: head.created_by_name,
      adjustment_reason: head.adjustment_reason,
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
  const sample: RetailerInventoryUsageRead[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      shop_id: "00000000-0000-4000-8000-000000000099",
      retailer_id: "00000000-0000-4000-8000-000000000050",
      retailer_name: "Ravi Store",
      inventory_item_id: "00000000-0000-4000-8000-000000000010",
      inventory_item_name: "Chicken",
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
      retailer_id: "00000000-0000-4000-8000-000000000050",
      retailer_name: "Ravi Store",
      inventory_item_id: "00000000-0000-4000-8000-000000000010",
      inventory_item_name: "Chicken",
      category_id: "00000000-0000-4000-8000-000000000021",
      category_name: "Wholesale",
      quantity: "3",
      bird_count: 2,
      unit: BaseUnit.KG,
      occurred_at: "2026-06-29T10:00:00.000Z",
      created_at: "2026-06-29T10:00:01.000Z",
    },
  ];
  const grouped = groupRetailerInventoryUsages(sample);
  console.assert(grouped.length === 1, "split retailer usage should group to one operation");
  console.assert(money(grouped[0]?.total_quantity ?? "0").toNumber() === 5, "split retailer usage should sum quantities");
  console.assert(grouped[0]?.categories.length === 2, "split retailer usage should keep category lines");
}
