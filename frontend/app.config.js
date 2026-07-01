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
const splashBackgroundColor = "#F7F1E8";
const androidIconForeground = "./assets/images/android-icon-foreground.png";
const androidIconBackground = "./assets/images/android-icon-background.png";
const androidIconMonochrome = "./assets/images/android-icon-monochrome.png";

const config = {
  name: "Brolier 360",
  slug: "brolier-360",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "brolier360",
  userInterfaceStyle: "light",
  icon: logoPath,
  splash: {
    image: logoPath,
    resizeMode: "contain",
    backgroundColor: splashBackgroundColor,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.anonymous.brolier360",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: splashBackgroundColor,
      foregroundImage: androidIconForeground,
      backgroundImage: androidIconBackground,
      monochromeImage: androidIconMonochrome,
    },
    splash: {
      image: logoPath,
      resizeMode: "contain",
      backgroundColor: splashBackgroundColor,
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
    package: "com.anonymous.brolier360",
  },
  web: {},
  plugins: [
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        image: logoPath,
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: splashBackgroundColor,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Brolier 360 to choose item images for catalogue and shop items.",
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
