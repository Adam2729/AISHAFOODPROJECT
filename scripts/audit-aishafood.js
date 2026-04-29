#!/usr/bin/env node
/*
  Read-only audit helper for AishaFoodProject.
  Usage: node scripts/audit-aishafood.js
*/

const fs = require("fs");
const path = require("path");

const root = process.cwd();

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listFilesRecursive(dirPath, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;
  const fileFilter = typeof options.fileFilter === "function" ? options.fileFilter : () => true;
  const out = [];

  function walk(currentPath, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (fileFilter(full, entry.name)) out.push(full);
      }
    }
  }

  if (exists(dirPath)) walk(dirPath, 0);
  return out;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function relativeFromRoot(fullPath) {
  return toPosix(path.relative(root, fullPath));
}

function extractEnvKeys(filePath) {
  const keys = [];
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return keys;
  }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (match) keys.push(match[1]);
  }
  return Array.from(new Set(keys)).sort();
}

function detectProjectDirs() {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const backend = dirs.includes("aisha-food-backend")
    ? path.join(root, "aisha-food-backend")
    : null;
  const app = dirs.includes("aisha-food-app") ? path.join(root, "aisha-food-app") : null;

  return { dirs: dirs.sort(), backend, app };
}

function summarizePackages(backendDir, appDir) {
  const backendPkg = backendDir
    ? readJsonSafe(path.join(backendDir, "package.json"))
    : null;
  const appPkg = appDir ? readJsonSafe(path.join(appDir, "package.json")) : null;

  function pickDeps(pkg, keys) {
    const deps = Object.assign({}, pkg && pkg.dependencies ? pkg.dependencies : {});
    const out = {};
    for (const key of keys) {
      if (deps[key]) out[key] = deps[key];
    }
    return out;
  }

  return {
    backend: backendPkg
      ? {
          name: backendPkg.name,
          next: backendPkg.dependencies && backendPkg.dependencies.next,
          react: backendPkg.dependencies && backendPkg.dependencies.react,
          mongoose: backendPkg.dependencies && backendPkg.dependencies.mongoose,
          keyLibs: pickDeps(backendPkg, [
            "next-auth",
            "jsonwebtoken",
            "jwt",
            "stripe",
            "pusher",
            "cloudinary",
            "mongoose",
            "nanoid",
          ]),
        }
      : null,
    app: appPkg
      ? {
          name: appPkg.name,
          expo: appPkg.dependencies && appPkg.dependencies.expo,
          react: appPkg.dependencies && appPkg.dependencies.react,
          reactNative: appPkg.dependencies && appPkg.dependencies["react-native"],
          keyLibs: pickDeps(appPkg, [
            "@react-navigation/native",
            "@react-navigation/native-stack",
            "@react-navigation/bottom-tabs",
            "@react-native-async-storage/async-storage",
          ]),
        }
      : null,
  };
}

function summarizeBackend(backendDir) {
  if (!backendDir) return null;

  const modelDir = path.join(backendDir, "src", "models");
  const apiDir = path.join(backendDir, "src", "app", "api");

  const models = exists(modelDir)
    ? fs
        .readdirSync(modelDir)
        .filter((name) => name.endsWith(".ts") || name.endsWith(".js"))
        .sort()
    : [];

  const routeFiles = listFilesRecursive(apiDir, {
    fileFilter: (_full, name) => name === "route.ts" || name === "route.js",
  })
    .map((full) => relativeFromRoot(full))
    .sort();

  const routeGroups = {};
  for (const file of routeFiles) {
    const parts = file.split("/");
    const domain = parts[4] || "unknown";
    routeGroups[domain] = (routeGroups[domain] || 0) + 1;
  }

  return {
    models,
    routeCount: routeFiles.length,
    routeGroups,
    routeFiles,
  };
}

function summarizeMobile(appDir) {
  if (!appDir) return null;

  const screensDir = path.join(appDir, "src", "screens");
  const screens = exists(screensDir)
    ? fs
        .readdirSync(screensDir)
        .filter((name) => name.endsWith(".js") || name.endsWith(".tsx") || name.endsWith(".ts"))
        .sort()
    : [];

  return {
    screenCount: screens.length,
    screens,
    appEntryExists: exists(path.join(appDir, "App.js")),
  };
}

function summarizeEnvFiles(backendDir, appDir) {
  const scanRoots = [root, backendDir, appDir].filter(Boolean);
  const envFiles = [];

  for (const scanRoot of scanRoots) {
    const files = listFilesRecursive(scanRoot, {
      maxDepth: 3,
      fileFilter: (_full, name) => name.startsWith(".env") || name.endsWith(".env.example"),
    });
    for (const file of files) {
      if (!envFiles.includes(file)) envFiles.push(file);
    }
  }

  envFiles.sort();

  const envSummary = envFiles.map((file) => ({
    file: relativeFromRoot(file),
    keys: extractEnvKeys(file),
  }));

  return envSummary;
}

function printHeading(title) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  const project = detectProjectDirs();
  const packages = summarizePackages(project.backend, project.app);
  const backend = summarizeBackend(project.backend);
  const mobile = summarizeMobile(project.app);
  const envFiles = summarizeEnvFiles(project.backend, project.app);

  printHeading("Repo");
  console.log(`Root: ${root}`);
  console.log(`Top-level directories: ${project.dirs.join(", ")}`);
  console.log(`Backend: ${project.backend ? relativeFromRoot(project.backend) : "not found"}`);
  console.log(`Mobile: ${project.app ? relativeFromRoot(project.app) : "not found"}`);

  printHeading("Packages");
  console.log(JSON.stringify(packages, null, 2));

  printHeading("Environment Files");
  console.log(JSON.stringify(envFiles, null, 2));

  printHeading("Backend Summary");
  console.log(JSON.stringify(backend, null, 2));

  printHeading("Mobile Summary");
  console.log(JSON.stringify(mobile, null, 2));
}

main();
