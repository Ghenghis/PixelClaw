/**
 * PixelClaw — Smoke Test Runner
 *
 * Validates that the project structure, build artifacts, and configuration
 * are correct before release. Exit code 0 = all pass, 1 = failures.
 *
 * Usage: node tests/smoke/run.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
let pass = 0;
let fail = 0;

function ok(label) {
    console.log(`  \x1b[32m[PASS]\x1b[0m ${label}`);
    pass++;
}

function bad(label, detail) {
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${label} — ${detail}`);
    fail++;
}

function fileExists(relPath, label) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
        ok(label || relPath);
    } else {
        bad(label || relPath, `file not found: ${relPath}`);
    }
}

function fileContains(relPath, needle, label) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
        bad(label, `file not found: ${relPath}`);
        return;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes(needle)) {
        ok(label);
    } else {
        bad(label, `expected to find "${needle}" in ${relPath}`);
    }
}

function jsonValid(relPath, label) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
        bad(label, `file not found: ${relPath}`);
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        ok(label);
        return data;
    } catch (e) {
        bad(label, `invalid JSON: ${e.message}`);
        return null;
    }
}

console.log("\n  ========================================");
console.log("  PixelClaw Smoke Tests");
console.log("  ========================================\n");

// --- 1. Project Structure ---
console.log("  [Project Structure]");
fileExists("package.json", "Root package.json exists");
fileExists("README.md", "README.md exists");
fileExists("LICENSE", "LICENSE exists");
fileExists(".gitignore", ".gitignore exists");
fileExists("docs/ARCHITECTURE.md", "Architecture doc exists");
fileExists("docs/pixelclaw-architecture.html", "Architecture HTML exists");

// --- 2. Extension Structure ---
console.log("\n  [Extension Structure]");
fileExists("extension/package.json", "Extension package.json");
fileExists("extension/src/extension.ts", "Extension entrypoint");
fileExists("extension/esbuild.js", "esbuild config");
fileExists("extension/tsconfig.json", "TypeScript config");
fileExists("extension/webview-ui/package.json", "Webview-ui package.json");
fileExists("extension/webview-ui/vite.config.ts", "Vite config");
fileExists("extension/webview-ui/index.html", "Webview index.html");

// --- 3. Package.json Validation ---
console.log("\n  [Package.json Validation]");
const rootPkg = jsonValid("package.json", "Root package.json is valid JSON");
const extPkg = jsonValid("extension/package.json", "Extension package.json is valid JSON");
const webPkg = jsonValid("extension/webview-ui/package.json", "Webview package.json is valid JSON");

if (extPkg) {
    if (extPkg.main === "./dist/extension.js") {
        ok("Extension main entry points to dist/extension.js");
    } else {
        bad("Extension main entry", `expected ./dist/extension.js, got ${extPkg.main}`);
    }
    if (extPkg.engines && extPkg.engines.vscode) {
        ok(`VS Code engine: ${extPkg.engines.vscode}`);
    } else {
        bad("VS Code engine", "engines.vscode not specified");
    }
}

// --- 4. GitHub Actions ---
console.log("\n  [GitHub Actions]");
fileExists(".github/workflows/ci.yml", "CI workflow exists");
fileExists(".github/workflows/release.yml", "Release workflow exists");
fileExists(".github/workflows/pages.yml", "Pages workflow exists");

// --- 5. Build Scripts ---
console.log("\n  [Build Scripts]");
fileExists("scripts/doctor.ps1", "Doctor script exists");
fileExists("scripts/package-zip.js", "Package ZIP script exists");

// --- 6. Build Output (optional — may not be built yet) ---
console.log("\n  [Build Output]");
const distExists = fs.existsSync(path.join(ROOT, "extension/dist/extension.js"));
const webviewExists = fs.existsSync(path.join(ROOT, "extension/dist/webview/index.html"));
if (distExists) {
    ok("extension/dist/extension.js exists");
    const stat = fs.statSync(path.join(ROOT, "extension/dist/extension.js"));
    if (stat.size > 1000) {
        ok(`extension.js size: ${(stat.size / 1024).toFixed(0)} KB`);
    } else {
        bad("extension.js size", `suspiciously small: ${stat.size} bytes`);
    }
} else {
    console.log("  \x1b[33m[SKIP]\x1b[0m extension not built yet (run npm run build)");
}
if (webviewExists) {
    ok("extension/dist/webview/index.html exists");
} else {
    console.log("  \x1b[33m[SKIP]\x1b[0m webview not built yet (run npm run build)");
}

// --- 7. Dependencies Check ---
console.log("\n  [Dependencies]");
if (fs.existsSync(path.join(ROOT, "extension/node_modules"))) {
    ok("extension/node_modules installed");
} else {
    bad("extension/node_modules", "not installed — run npm run install:all");
}
if (fs.existsSync(path.join(ROOT, "extension/webview-ui/node_modules"))) {
    ok("extension/webview-ui/node_modules installed");
} else {
    bad("webview-ui/node_modules", "not installed — run npm run install:all");
}

// --- 8. Node.js Version ---
console.log("\n  [Runtime]");
try {
    const nodeVer = execSync("node --version", { encoding: "utf8" }).trim();
    const major = parseInt(nodeVer.replace("v", "").split(".")[0], 10);
    if (major >= 20) {
        ok(`Node.js ${nodeVer}`);
    } else {
        bad(`Node.js ${nodeVer}`, "requires >= 20");
    }
} catch {
    bad("Node.js", "not found");
}

// --- Summary ---
console.log("\n  ========================================");
console.log(`  Results: \x1b[32m${pass} passed\x1b[0m, \x1b[31m${fail} failed\x1b[0m`);
console.log("  ========================================\n");

process.exit(fail > 0 ? 1 : 0);
