export type UserRole = "admin" | "shop_account";
export type BaseUnit = "kg" | "unit";
export type UnitType = "weight" | "count";
export type AnalyticsPeriod = "date" | "month" | "week" | "year";
export type UUID = string;

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
  unit_type: UnitType;
  base_unit: BaseUnit;
  current_price?: string | null;
  image_path?: string | null;
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

export interface BillLineRead {
  item_id: UUID;
  item_name: string;
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
