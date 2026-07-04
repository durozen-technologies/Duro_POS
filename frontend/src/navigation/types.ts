import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type {
  AdminReportDetailLevel,
  AdminReportSection,
  AnalyticsDateRange,
} from "@/api/admin";
import type {
  AdminItemEditorMode,
  AdminItemWorkspace,
} from "@/screens/admin/admin-items-model";
import type {
  AnalyticsPeriod,
  InventoryItemRead,
  ShopItemRead,
  UUID,
} from "@/types/api";

export type AppStackParamList = {
  AppLoading: undefined;
  BootstrapState: undefined;
  Login: undefined;
  SuperAdminDashboard: undefined;
  SuperAdminBillingOverview: undefined;
  SuperAdminOrgs: undefined;
  SuperAdminOrgEdit: { org: import("@/api/super-admin").OrganizationRead };
  SuperAdminAdmins: undefined;
  SuperAdminAudit: undefined;
  SuperAdminHardDelete: {
    resourceType: "organization" | "tenantAdmin" | "branch";
    resourceId: UUID;
    resourceName: string;
    organizationId?: UUID;
  };
  AdminDashboard: undefined;
  AdminItemsCatalogue: undefined;
  AdminItemAssumption: undefined;
  AdminShopItems: { shopId?: UUID } | undefined;
  AdminShopItemsOrder: { shopId: UUID; shopName?: string };
  AdminItemPrices: { shopId?: UUID } | undefined;
  AdminItemCategories: undefined;
  AdminInventory:
    | {
        shopId?: UUID;
        tab?:
          "items" | "categories" | "purchaseRates" | "shops" | "transferShops";
      }
    | undefined;
  AdminReports: undefined;
  AdminOverallReportPreview: {
    sections: AdminReportSection[];
    detailLevel: AdminReportDetailLevel;
    period: AnalyticsPeriod;
    referenceDate?: string | null;
    range?: AnalyticsDateRange;
    shopIds?: UUID[];
    language?: "en" | "ta";
  };
  AdminExpenses: { shopId?: UUID } | undefined;
  AdminShopExpensesOrder: { shopId: UUID; shopName?: string };
  AdminExpenseItemEditor:
    | {
        initialItem?: import("@/types/api").ExpenseItemRead;
      }
    | undefined;
  AdminRetailers:
    | {
        tab?: import("@/screens/admin/admin-dashboard-utils").AdminRetailersTab;
        retailerId?: UUID;
      }
    | undefined;
  AdminRetailerEditor:
    | {
        initialRetailer?: import("@/types/api").RetailerRead;
      }
    | undefined;
  AdminRetailerDetail: { retailer: import("@/types/api").RetailerRead };
  AdminRetailerBranches: {
    retailerId: UUID;
    retailerName: string;
    requireSelection?: boolean;
  };
  AdminRetailerItems: { retailerId: UUID; retailerName: string };
  AdminRetailerSaleDetail: { saleId: UUID };
  AdminInventoryItemEditor:
    | {
        itemId?: UUID;
        initialItem?: InventoryItemRead;
      }
    | undefined;
  AdminItemEditor: {
    mode: AdminItemEditorMode;
    workspace: AdminItemWorkspace;
    itemId?: UUID;
    shopId?: UUID;
    initialItem?: ShopItemRead;
  };
  Billing: undefined;
  Checkout: undefined;
  RetailerSelect: undefined;
  RetailerSales: undefined;
  RetailerBilling: { retailerId: UUID; retailerName: string };
  RetailerCheckout: { retailerId: UUID; retailerName: string };
  RetailerSaleDetail: { saleId: UUID };
  InventoryManagement: undefined;
  ShopExpenses: undefined;
  PrinterSetup: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "Login"
>;
export type SuperAdminDashboardScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminDashboard"
>;
export type SuperAdminBillingOverviewScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminBillingOverview"
>;
export type SuperAdminOrgsScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminOrgs"
>;
export type SuperAdminOrgEditScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminOrgEdit"
>;
export type SuperAdminAdminsScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminAdmins"
>;
export type SuperAdminAuditScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminAudit"
>;
export type SuperAdminHardDeleteScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "SuperAdminHardDelete"
>;
export type AdminDashboardScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminDashboard"
>;
export type AdminItemsCatalogueScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminItemsCatalogue"
>;
export type AdminItemAssumptionScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminItemAssumption"
>;
export type AdminShopItemsScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminShopItems"
>;
export type AdminShopItemsOrderScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminShopItemsOrder"
>;
export type AdminItemPricesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminItemPrices"
>;
export type AdminItemCategoriesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminItemCategories"
>;
export type AdminInventoryScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminInventory"
>;
export type AdminReportsScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminReports"
>;
export type AdminOverallReportPreviewScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminOverallReportPreview"
>;
export type AdminExpensesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminExpenses"
>;
export type AdminShopExpensesOrderScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminShopExpensesOrder"
>;
export type AdminExpenseItemEditorScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminExpenseItemEditor"
>;
export type AdminRetailersScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailers"
>;
export type AdminRetailerEditorScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailerEditor"
>;
export type AdminRetailerDetailScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailerDetail"
>;
export type AdminRetailerBranchesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailerBranches"
>;
export type AdminRetailerItemsScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailerItems"
>;
export type AdminRetailerSaleDetailScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminRetailerSaleDetail"
>;
export type AdminInventoryItemEditorScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminInventoryItemEditor"
>;
export type AdminItemEditorScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "AdminItemEditor"
>;
export type BillingScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "Billing"
>;
export type CheckoutScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "Checkout"
>;
export type RetailerSelectScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "RetailerSelect"
>;
export type RetailerSalesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "RetailerSales"
>;
export type RetailerBillingScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "RetailerBilling"
>;
export type RetailerCheckoutScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "RetailerCheckout"
>;
export type RetailerSaleDetailScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "RetailerSaleDetail"
>;
export type InventoryManagementScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "InventoryManagement"
>;
export type ShopExpensesScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "ShopExpenses"
>;
export type PrinterSetupScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "PrinterSetup"
>;
