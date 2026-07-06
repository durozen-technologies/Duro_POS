import type { LinkingOptions } from "@react-navigation/native";
import * as Linking from "expo-linking";

import type { AppStackParamList } from "@/navigation/types";

const prefix = Linking.createURL("/");

export const navigationLinking: LinkingOptions<AppStackParamList> = {
  prefixes: [prefix, "brolier360://"],
  config: {
    screens: {
      Login: "login",
      Billing: "shop",
      AdminDashboard: "admin",
      SuperAdminDashboard: "super-admin",
    },
  },
};
