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
  SuperAdminOrgs: undefined;
  SuperAdminOrgEdit: { org: import("@/api/super-admin").OrganizationRead };
  SuperAdminAdmins: undefined;
  SuperAdminAudit: undefined;
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
