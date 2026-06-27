export type UUID = string;

export enum UserRole {
  ADMIN = "admin",
  SHOP_ACCOUNT = "shop_account",
}

export enum BaseUnit {
  KG = "kg",
  UNIT = "unit",
}

export enum UnitType {
  WEIGHT = "weight",
  COUNT = "count",
}

export enum InventoryMovementType {
  ADD = "add",
  USE = "use",
}

export enum ItemAssumptionStatus {
  NotApplicable = "not_applicable",
  NotSet = "not_set",
  Incomplete = "incomplete",
  Configured = "configured",
}

export enum AnalyticsPeriod {
  DATE = "date",
  MONTH = "month",
  WEEK = "week",
  YEAR = "year",
  RANGE = "range",
}

export enum PriceStatus {
  Missing = "missing",
  Stale = "stale",
  Current = "current",
}

export enum ItemScope {
  Global = "global",
  Shop = "shop",
}

export enum BillStatus {
  PENDING_PAYMENT = "pending_payment",
  PAID = "paid",
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

export interface ItemCategoryUpdate {
  name: string;
}

export interface InventoryCategoryRead {
  id: UUID;
  name: string;
  created_at: string;
  updated_at?: string | null;
}

export interface InventoryBillingItemMappingRead {
  inventory_category_id?: UUID | null;
  inventory_category_name?: string | null;
  billing_item_id: UUID;
  billing_item_name: string;
  billing_item_tamil_name?: string | null;
}

export interface InventoryBillingItemMappingWrite {
  inventory_category_id?: UUID | null;
  billing_item_id: UUID;
}

export interface InventoryCategoryCreate {
  name: string;
}

export interface InventoryCategoryUpdate {
  name: string;
}

export interface InventoryItemRead {
  id: UUID;
  name: string;
  tamil_name: string;
  unit_type: UnitType;
  base_unit: BaseUnit;
  is_active: boolean;
  sort_order: number;
  purchase_rate: string;
  billing_item_id?: UUID | null;
  billing_item_ids: UUID[];
  billing_items: InventoryBillingItemMappingRead[];
  category_ids: UUID[];
  category_billing_item_ids: Record<UUID, UUID>;
  categories: InventoryCategoryRead[];
  created_at: string;
  updated_at?: string | null;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
}

export interface InventoryItemRowsPage {
  items: InventoryItemRead[];
  limit: number;
  has_more: boolean;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface InventoryItemCounts {
  all: number;
  active: number;
  paused: number;
}

export interface InventoryPurchaseRatesConfirmRead {
  updated_count: number;
}

export interface InventoryItemImageRead {
  inventory_item_id: UUID;
  inventory_item_name: string;
  inventory_item_tamil_name?: string | null;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
}

export interface InventoryCategoryUsageRead {
  category_id: UUID;
  category_name: string;
  available_quantity: string;
  used_quantity: string;
}

export interface InventoryItemStockRead extends InventoryItemRead {
  allocated: boolean;
  allocation_active: boolean;
  allocation_sort_order: number;
  available_quantity: string;
  added_quantity: string;
  used_quantity: string;
  category_usage: InventoryCategoryUsageRead[];
}

export interface InventorySummaryRead {
  shop_id: UUID;
  shop_name: string;
  items: InventoryItemStockRead[];
  categories: InventoryCategoryUsageRead[];
}

export interface InventoryStockRowsPage {
  shop_id: UUID;
  shop_name: string;
  items: InventoryItemStockRead[];
  limit: number;
  has_more: boolean;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface InventoryMovementRead {
  id: UUID;
  shop_id: UUID;
  shop_name?: string | null;
  inventory_item_id: UUID;
  inventory_item_name: string;
  inventory_item_tamil_name?: string | null;
  category_id?: UUID | null;
  category_name?: string | null;
  movement_type: InventoryMovementType;
  quantity: string;
  unit: BaseUnit;
  driver_name?: string | null;
  vehicle_number?: string | null;
  created_at: string;
}

export interface InventoryMovementPage {
  items: InventoryMovementRead[];
  limit: number;
  has_more: boolean;
}

export interface InventoryAddRequest {
  quantity: string;
  driver_name: string;
  vehicle_number: string;
}

export interface InventoryUseRequest {
  category_id?: UUID | null;
  quantity: string;
}

export interface InventoryUseSplitLine {
  category_id: UUID;
  quantity: string;
}

export interface InventoryUseSplitRequest {
  total_quantity: string;
  categories: InventoryUseSplitLine[];
}

export interface InventoryTransferRead {
  id: UUID;
  source_shop_id: UUID;
  transfer_shop_id: UUID;
  inventory_item_id: UUID;
  quantity: string;
  unit: BaseUnit;
  created_at: string;
  source_shop_name?: string | null;
  transfer_shop_name?: string | null;
  inventory_item_name?: string | null;
  inventory_item_tamil_name?: string | null;
}

export interface InventoryTransferPage {
  items: InventoryTransferRead[];
  limit: number;
  has_more: boolean;
}

export interface InventoryMovementCreateResult {
  movement: InventoryMovementRead;
  item: InventoryItemStockRead;
  summary?: InventorySummaryRead | null;
}

export interface InventoryMovementSplitCreateResult {
  movements: InventoryMovementRead[];
  item: InventoryItemStockRead;
  summary?: InventorySummaryRead | null;
}

export interface ExpenseItemCreate {
  name: string;
  tamil_name: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface ExpenseItemUpdate {
  name: string;
  tamil_name: string;
  sort_order: number;
  is_active: boolean;
}

export interface ExpenseItemRead {
  id: UUID;
  name: string;
  tamil_name: string;
  sort_order: number;
  is_active: boolean;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
  created_at: string;
  updated_at?: string | null;
  allocated_shop_count: number;
  entry_count: number;
  can_delete: boolean;
}

export interface ShopExpenseItemRead extends ExpenseItemRead {
  allocated: boolean;
  allocation_id?: UUID | null;
  allocation_is_active: boolean;
  allocation_sort_order: number;
}

export interface ExpenseItemRowsPage {
  items: ExpenseItemRead[];
  limit: number;
  has_more: boolean;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface ShopExpenseItemRowsPage {
  items: ShopExpenseItemRead[];
  limit: number;
  has_more: boolean;
  next_cursor_sort_order?: number | null;
  next_cursor_name?: string | null;
  next_cursor_id?: UUID | null;
}

export interface ExpenseItemCounts {
  all: number;
  active: number;
  paused: number;
  allocated: number;
  available: number;
}

export interface ShopExpenseAllocationBulkCreate {
  expense_item_ids: UUID[];
}

export interface ShopExpenseAllocationBulkRead {
  expense_item_ids: UUID[];
  allocated_count: number;
  already_allocated_count: number;
}

export interface ShopExpenseAllocationUpdate {
  is_active?: boolean | null;
  sort_order?: number | null;
}

export interface ShopExpenseItemsOrderUpdate {
  expense_item_ids: UUID[];
}

export interface ShopExpenseItemsOrderRead {
  expense_item_ids: UUID[];
}

export interface ExpenseEntryCreate {
  expense_item_id: UUID;
  amount: string;
  spent_at?: string | null;
  note?: string | null;
}

export interface ExpenseEntryRead {
  id: UUID;
  shop_id: UUID;
  shop_name: string;
  expense_item_id: UUID;
  expense_name: string;
  expense_tamil_name: string;
  image_path?: string | null;
  image_thumb_path?: string | null;
  image_content_type?: string | null;
  amount: string;
  spent_at: string;
  note?: string | null;
  created_at: string;
}

export interface ExpenseEntryPage {
  items: ExpenseEntryRead[];
  limit: number;
  has_more: boolean;
  total_amount: string;
  next_cursor_spent_at?: string | null;
  next_cursor_id?: UUID | null;
}

export interface ShopInventoryAllocationBulkCreate {
  item_ids: UUID[];
}

export interface ShopInventoryAllocationBulkRead {
  item_ids: UUID[];
  allocated_count: number;
  already_allocated_count: number;
}

export interface ShopInventoryAllocationUpdate {
  item_id: UUID;
  is_active?: boolean | null;
  sort_order?: number | null;
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
  assumption_percent?: string | null;
  assumption_inventory_item_id?: UUID | null;
  assumption_inventory_category_id?: UUID | null;
  assumption_status?: ItemAssumptionStatus;
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

export interface ItemAssumptionUpdate {
  assumption_percent?: string | null;
  assumption_inventory_item_id?: UUID | null;
  assumption_inventory_category_id?: UUID | null;
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

export interface ShopSelectedItemsOrderUpdate {
  item_ids: UUID[];
}

export interface ShopSelectedItemsOrderRead {
  item_ids: UUID[];
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
  status: BillStatus;
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
  last_active_at?: string | null;
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

export interface OverallReportUnitSummary {
  unit: BaseUnit;
  old_stock: string;
  adding_stock: string;
  total_available_stock: string;
  used_stock: string;
  transfer_stock: string;
  remaining_stock: string;
  sales_quantity: string;
  assumption_quantity: string;
  difference_quantity: string;
}

export interface OverallReportBillingItem {
  billing_item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  category: string;
  unit: BaseUnit;
  assumption_percent?: string | null;
  sales_quantity: string;
  assumption_quantity: string;
  difference_quantity: string;
  today_price?: string | null;
  sales_amount: string;
  assumption_amount: string;
  difference_amount: string;
}

export interface OverallReportUsedStockBreakdown {
  category_id?: UUID | null;
  category_name?: string | null;
  label: string;
  quantity: string;
}

export interface OverallReportInventoryItem {
  inventory_item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  category: string;
  unit: BaseUnit;
  old_stock: string;
  adding_stock: string;
  total_available_stock: string;
  used_stock: string;
  transfer_stock: string;
  remaining_stock: string;
  sales_quantity: string;
  assumption_quantity: string;
  difference_quantity: string;
  sales_amount: string;
  assumption_amount: string;
  purchase_rate: string;
  purchase_amount: string;
  difference_amount: string;
  used_stock_breakdown: OverallReportUsedStockBreakdown[];
  billing_items: OverallReportBillingItem[];
}

export interface OverallReportStatement {
  shop_id: UUID;
  shop_name: string;
  start_date: string;
  end_date: string;
  period_label: string;
  unit_summaries: OverallReportUnitSummary[];
  expense_amount: string;
  sales_amount: string;
  assumption_amount: string;
  purchase_amount: string;
  difference_amount: string;
  sales_minus_expense_amount: string;
  sales_minus_assumption_amount: string;
  inventory_items: OverallReportInventoryItem[];
}

export interface OverallReportRead {
  period: AnalyticsPeriod;
  detail_level: "summary" | "full";
  period_label: string;
  statements: OverallReportStatement[];
}

export interface AdminBillSummary {
  bill_id: UUID;
  bill_no: string;
  shop_id: UUID;
  shop_name: string;
  total_amount: string;
  status: BillStatus;
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

export interface TransferShopCreate {
  name: string;
  tamil_name: string;
  is_active: boolean;
}

export interface TransferShopUpdate {
  name?: string | null;
  tamil_name?: string | null;
  is_active?: boolean | null;
}

export interface TransferShopRead {
  id: UUID;
  name: string;
  tamil_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryTransferCreate {
  transfer_shop_id: UUID;
  quantity: string;
}

export interface InventoryTransferRead {
  id: UUID;
  source_shop_id: UUID;
  transfer_shop_id: UUID;
  inventory_item_id: UUID;
  quantity: string;
  unit: BaseUnit;
  created_at: string;
  source_shop_name?: string | null;
  transfer_shop_name?: string | null;
  inventory_item_name?: string | null;
  inventory_item_tamil_name?: string | null;
}

export interface InventoryTransferPage {
  items: InventoryTransferRead[];
  limit: number;
  has_more: boolean;
}
