import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type AppStackParamList = {
  AppLoading: undefined;
  BootstrapState: undefined;
  Login: undefined;
  AdminDashboard: undefined;
  Billing: undefined;
  Checkout: undefined;
  PrinterSetup: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<AppStackParamList, "Login">;
export type AdminDashboardScreenProps = NativeStackScreenProps<AppStackParamList, "AdminDashboard">;
export type BillingScreenProps = NativeStackScreenProps<AppStackParamList, "Billing">;
export type CheckoutScreenProps = NativeStackScreenProps<AppStackParamList, "Checkout">;
export type PrinterSetupScreenProps = NativeStackScreenProps<AppStackParamList, "PrinterSetup">;
