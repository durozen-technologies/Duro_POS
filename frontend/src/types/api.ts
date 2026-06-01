export type UserRole = "admin" | "shop_account";
export type BaseUnit = "kg" | "unit";
export type UnitType = "weight" | "count";
export type AnalyticsPeriod = "date" | "month" | "week" | "year";
export type UUID = string;

export enum PriceStatus {
  Missing = "missing",
  Stale = "stale",
  Current = "current",
}

export enum ItemScope {
  Global = "global",
  Shop = "shop",
}

export interface UserSession {
  id: UUID;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  shop_id?: UUID | null;
  shop_name?: string | null;
  requires_price_setup?: boolean;
  next_screen: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  confirm_password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: UserSession;
}

export interface ItemPriceRead {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  unit_type: UnitType;
  base_unit: BaseUnit;
  current_price?: string | null;
  latest_price_date?: string | null;
  price_status?: PriceStatus;
  sort_order?: number;
  category_id?: UUID | null;
  category?: string | null;
  image_path?: string | null;
  image_thumb_path?: string | null;
}

export interface ItemCategoryRead {
  id: UUID;
  name: string;
  created_at: string;
  updated_at?: string | null;
}

export interface ItemCategoryCreate {
  name: string;
}

export interface ItemRead {
  id: UUID;
  shop_id?: UUID | null;
  name: string;
  tamil_name?: string | null;
  unit_type: UnitType;
  base_unit: BaseUnit;
  is_active: boolean;
  sort_order: number;
  category_id?: UUID | null;
  category?: string | null;
  created_at: string;
  updated_at?: string | null;
  custom_attributes: Record<string, string | number | boolean | null>;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
}

export interface ItemImageRead {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
}

export interface ItemMetadataUpdate {
  name?: string;
  tamil_name?: string;
  unit_type?: UnitType;
  base_unit?: BaseUnit;
  is_active?: boolean;
  sort_order?: number;
  category_id?: UUID | null;
  category?: string | null;
  custom_attributes?: Record<string, string | number | boolean | null>;
}

export interface ShopItemAllocationUpdate {
  display_name?: string | null;
  tamil_name?: string | null;
  is_active?: boolean;
  sort_order?: number;
  custom_attributes?: Record<string, string | number | boolean | null>;
}

export interface ShopItemAllocationBulkCreate {
  item_ids: UUID[];
}

export interface ShopItemAllocationBulkRead {
  item_ids: UUID[];
  allocated_count: number;
  already_allocated_count: number;
}

export interface ShopItemRead extends ItemRead {
  current_price?: string | null;
  price_date?: string | null;
  latest_price_date?: string | null;
  price_status: PriceStatus;
  scope: ItemScope;
  allocated: boolean;
  available_for_billing: boolean;
  can_delete: boolean;
  can_deallocate: boolean;
  bill_count: number;
  price_count: number;
  allocated_shop_count: number;
}

export interface ShopItemCounts {
  all: number;
  allocated: number;
  available: number;
  catalogue: number;
  shop: number;
  priced: number;
  needs_price: number;
  stale_price: number;
  paused: number;
}

export interface ShopItemPage {
  items: ShopItemRead[];
  limit: number;
  total_count: number;
  counts: ShopItemCounts;
  has_more: boolean;
  next_cursor_group?: number | null;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface AdminItemRowsPage {
  items: ShopItemRead[];
  limit: number;
  has_more: boolean;
  next_cursor_group?: number | null;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface ShopBootstrapResponse {
  shop_id: UUID | null;
  shop_name: string;
  price_date: string;
  prices_set: boolean;
  next_screen: string;
  items: ItemPriceRead[];
}

export interface DailyPriceEntry {
  item_id: UUID;
  price_per_unit: string;
}

export interface DailyPriceCreate {
  entries: DailyPriceEntry[];
}

export interface DailyPriceUpdate {
  price_per_unit: string;
}

export interface DailyPriceRead {
  id: UUID;
  item_id: UUID;
  price_per_unit: string;
  unit: BaseUnit;
  price_date: string;
  created_at: string;
}

export interface BillItemInput {
  item_id: UUID;
  quantity: string;
}

export interface CheckoutPaymentInput {
  cash_amount: string;
  upi_amount: string;
}

export interface BillCheckoutRequest {
  items: BillItemInput[];
  payment: CheckoutPaymentInput;
}

export interface BillCheckoutCommitRequest extends BillCheckoutRequest {
  checkout_token: string;
}

export interface BillLineRead {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  item_unit_type?: UnitType | null;
  item_base_unit?: BaseUnit | null;
  quantity: string;
  unit: BaseUnit;
  price_per_unit: string;
  line_total: string;
}

export interface PaymentRead {
  id: UUID;
  cash_amount: string;
  upi_amount: string;
  total_paid: string;
  balance: string;
  is_settled: boolean;
}

export interface ReceiptRead {
  id: UUID;
  receipt_number: string;
  printed_at: string;
}

export interface BillRead {
  id: UUID;
  bill_no: string;
  shop_id: UUID;
  shop_name: string;
  total_amount: string;
  status: string;
  created_at: string;
  items: BillLineRead[];
  payment: PaymentRead;
  receipt: ReceiptRead;
}

export interface BillCheckoutPreviewRead extends BillRead {
  checkout_token: string;
}

export interface ShopCreate {
  name: string;
  username: string;
  password: string;
}

export interface ShopUpdate {
  name: string;
  username: string;
  password?: string | null;
}

export interface ShopRead {
  id: UUID;
  name: string;
  is_active: boolean;
  created_at: string;
  username: string;
}

export interface ShopStatusUpdate {
  is_active: boolean;
}

export interface ShopSalesSummary {
  shop_id: UUID;
  shop_name: string;
  total_sales: string;
}

export interface PaymentSplitSummary {
  shop_id: UUID;
  shop_name: string;
  cash_total: string;
  upi_total: string;
}

export interface ItemSalesSummary {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  base_unit: BaseUnit;
  quantity_sold: string;
  total_amount: string;
  bill_count: number;
}

export interface AdminBillSummary {
  bill_id: UUID;
  bill_no: string;
  shop_id: UUID;
  shop_name: string;
  total_amount: string;
  status: string;
  created_at: string;
}

export interface AdminBillShopStat {
  shop_id: UUID;
  bill_count: number;
  last_bill_at?: string | null;
}

export interface AdminBillPage {
  items: AdminBillSummary[];
  limit: number;
  has_more: boolean;
  total_count: number;
  largest_bill?: AdminBillSummary | null;
  shop_stats: AdminBillShopStat[];
  next_cursor_created_at?: string | null;
  next_cursor_id?: UUID | null;
}


export interface DashboardShopSummary {
  shop_id: UUID;
  shop_name: string;
  total_sales: string | number;
  cash_total: string | number;
  upi_total: string | number;
  bill_count: number;
  last_bill_at: string | null;
}

export interface AdminDashboardBootstrap {
  shops: ShopRead[];
  sales_summary: ShopSalesSummary[];
  payment_summary: PaymentSplitSummary[];
  bills: AdminBillPage;
  item_sales: ItemSalesSummary[];
}
