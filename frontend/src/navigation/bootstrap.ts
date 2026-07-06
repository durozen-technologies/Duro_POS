import "react-native-gesture-handler";

import { startAuthBootstrap } from "@/auth/bootstrap-auth";
import { enableScreens } from "react-native-screens";

enableScreens();
startAuthBootstrap();