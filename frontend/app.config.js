const fs = require("fs");
const path = require("path");

function readEnvFileValue(key) {
  try {
    const envPath = path.join(__dirname, ".env");
    const file = fs.readFileSync(envPath, "utf-8");
    const line = file
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));

    if (!line) {
      return "";
    }

    return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return "";
  }
}

const expoPublicApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  readEnvFileValue("EXPO_PUBLIC_API_BASE_URL");
const logoPath = "./assets/Logo.png";

const config = {
  name: "Meat Billing POS",
  slug: "meat-billing-pos",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "meatbillingpos",
  userInterfaceStyle: "light",
  icon: logoPath,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.anonymous.meatbillingpos",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: logoPath,
      backgroundColor: "#ffffff",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.READ_MEDIA_IMAGES",
    ],
    package: "com.anonymous.meatbillingpos",
  },
  web: {},
  plugins: [
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Meat Billing POS to choose item images for catalogue and shop items.",
      },
    ],
  ],
  extra: {
    eas: {
      projectId: "8bd0810a-72de-43b3-a836-8c0d78481136",
    },
  },
};

module.exports = () => ({
  expo: {
    ...config,
    extra: {
      ...config.extra,
      expoPublicApiBaseUrl,
    },
  },
});
