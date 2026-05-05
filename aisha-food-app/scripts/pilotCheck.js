const fs = require("node:fs");
const path = require("node:path");
const EXPECTED_ANDROID_PACKAGE = "com.aishafood.app";

function line(text = "") {
  process.stdout.write(`${text}\n`);
}

function readAndroidPackage() {
  const appJsonPath = path.join(process.cwd(), "app.json");
  if (!fs.existsSync(appJsonPath)) return "";
  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    return String(appJson?.expo?.android?.package || "").trim();
  } catch {
    return "";
  }
}

line("OranjeEats Android pilot check");
line("");
line("Required before running an EAS build:");
line("- EXPO_PUBLIC_LAUNCH_ENV must be set to local, preview, or production.");
line("- EXPO_PUBLIC_API_URL must point to the matching backend for that environment.");
line("- Preview and production must use a public HTTPS backend.");
line("- Run `npx eas-cli login` if you are not already logged in.");
line(`- Confirm the Android package is \`${EXPECTED_ANDROID_PACKAGE}\`.`);
const configuredPackage = readAndroidPackage();
line(`- Current app.json Android package: \`${configuredPackage || "not set"}\`.`);
line("");
line("Next commands:");
line("- npm run validate:launch:env");
line("- npm run eas:build:android:preview");
line("- npm run eas:build:android:production");
