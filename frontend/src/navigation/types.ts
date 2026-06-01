import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type {
  AdminItemEditorMode,
  AdminItemWorkspace,
} from "@/screens/admin/admin-items-model";
import type { ShopItemRead, UUID } from "@/types/api";

export type AppStackParamList = {
  AppLoading: undefined;
  BootstrapState: undefined;
  Login: undefined;
  AdminDashboard: undefined;
  AdminItemsCatalogue: undefined;
  AdminShopItems: { shopId?: UUID } | undefined;
  AdminItemPrices: { shopId?: UUID } | undefined;
  AdminItemEditor: {
    mode: AdminItemEditorMode;
    workspace: AdminItemWorkspace;
    itemId?: UUID;
    shopId?: UUID;
    initialItem?: ShopItemRead;
  };
  Billing: undefined;
  Checkout: undefined;
  PrinterSetup: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<AppStackParamList, "Login">;
export type AdminDashboardScreenProps = NativeStackScreenProps<AppStackParamList, "AdminDashboard">;
export type AdminItemsCatalogueScreenProps = NativeStackScreenProps<AppStackParamList, "AdminItemsCatalogue">;
export type AdminShopItemsScreenProps = NativeStackScreenProps<AppStackParamList, "AdminShopItems">;
export type AdminItemPricesScreenProps = NativeStackScreenProps<AppStackParamList, "AdminItemPrices">;
export type AdminItemEditorScreenProps = NativeStackScreenProps<AppStackParamList, "AdminItemEditor">;
export type BillingScreenProps = NativeStackScreenProps<AppStackParamList, "Billing">;
export type CheckoutScreenProps = NativeStackScreenProps<AppStackParamList, "Checkout">;
export type PrinterSetupScreenProps = NativeStackScreenProps<AppStackParamList, "PrinterSetup">;
