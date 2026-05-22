const fs = require("fs");
const path = require("path");

const bundledDependencyRoot = path.join(
  __dirname,
  "..",
  "node_modules",
  "@haroldtran",
  "react-native-thermal-printer",
  "node_modules",
);
const bluetoothPrinterAndroidRoot = path.join(
  __dirname,
  "..",
  "node_modules",
  "react-native-bluetooth-escpos-printer",
  "android",
);

const patchedBluetoothBuildGradle = `apply plugin: 'com.android.library'

def safeExtGet(prop, fallback) {
    rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}

android {
    namespace 'cn.jystudio.bluetooth'
    compileSdkVersion safeExtGet('compileSdkVersion', 36)

    defaultConfig {
        minSdkVersion safeExtGet('minSdkVersion', 24)
        targetSdkVersion safeExtGet('targetSdkVersion', 36)
        versionCode 1
        versionName "1.0"
    }

    lint {
        abortOnError false
    }

    sourceSets {
        main {
            aidl.srcDirs = ['src/main/java']
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation 'com.facebook.react:react-android'
    implementation 'androidx.core:core:1.13.1'
    implementation "com.google.zxing:core:3.3.0"
}
`;

function updateFile(filePath, nextContents, label) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const currentContents = fs.readFileSync(filePath, "utf8");
  if (currentContents === nextContents) {
    return;
  }

  fs.writeFileSync(filePath, nextContents);
  console.log(`Patched ${label}`);
}

for (const packageName of ["react", "react-native"]) {
  const packagePath = path.join(bundledDependencyRoot, packageName);

  if (!fs.existsSync(packagePath)) {
    continue;
  }

  fs.rmSync(packagePath, { recursive: true, force: true });
  console.log(`Removed bundled duplicate dependency: ${packageName}`);
}

updateFile(
  path.join(bluetoothPrinterAndroidRoot, "build.gradle"),
  patchedBluetoothBuildGradle,
  "react-native-bluetooth-escpos-printer/android/build.gradle",
);

const bluetoothManagerModulePath = path.join(
  bluetoothPrinterAndroidRoot,
  "src",
  "main",
  "java",
  "cn",
  "jystudio",
  "bluetooth",
  "RNBluetoothManagerModule.java",
);

if (fs.existsSync(bluetoothManagerModulePath)) {
  const currentContents = fs.readFileSync(bluetoothManagerModulePath, "utf8");
  const nextContents = currentContents
    .replace(
      "import android.support.v4.app.ActivityCompat;",
      "import androidx.core.app.ActivityCompat;",
    )
    .replace(
      "import android.support.v4.content.ContextCompat;",
      "import androidx.core.content.ContextCompat;",
    );

  if (nextContents !== currentContents) {
    fs.writeFileSync(bluetoothManagerModulePath, nextContents);
    console.log(
      "Patched react-native-bluetooth-escpos-printer AndroidX imports",
    );
  }
}
