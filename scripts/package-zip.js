/**
 * PixelClaw — Package ZIP for Windows Release
 *
 * Creates a ready-to-use ZIP containing:
 *   - Built VSIX
 *   - install.bat / uninstall.bat
 *   - Documentation
 *   - README + LICENSE
 *
 * Usage: node scripts/package-zip.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RELEASES_DIR = path.join(ROOT, "releases");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "package.json"), "utf8"));
const VERSION = `v${PKG.version}`;
const ZIP_NAME = `pixelclaw-${VERSION}-win-x64.zip`;
const STAGING_DIR = path.join(RELEASES_DIR, `pixelclaw-${VERSION}-win-x64`);

console.log(`\n  PixelClaw Package ZIP — ${VERSION}\n`);

// Find VSIX
const vsixFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith(".vsix"));
if (vsixFiles.length === 0) {
    console.error("  ERROR: No .vsix file found in releases/. Run 'npm run package' first.");
    process.exit(1);
}
const vsixFile = vsixFiles[vsixFiles.length - 1];
console.log(`  Found VSIX: ${vsixFile}`);

// Clean staging
if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });
fs.mkdirSync(path.join(STAGING_DIR, "docs"), { recursive: true });

// Copy VSIX
fs.copyFileSync(path.join(RELEASES_DIR, vsixFile), path.join(STAGING_DIR, vsixFile));
console.log(`  Copied ${vsixFile}`);

// Copy docs
const docFiles = [
    ["docs/ARCHITECTURE.md", "docs/ARCHITECTURE.md"],
    ["docs/pixelclaw-architecture.html", "docs/pixelclaw-architecture.html"],
    ["README.md", "README.md"],
    ["LICENSE", "LICENSE"],
];
for (const [src, dst] of docFiles) {
    const srcPath = path.join(ROOT, src);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(STAGING_DIR, dst));
        console.log(`  Copied ${src}`);
    }
}

// Create install.bat
const installBat = `@echo off
echo ============================================
echo   PixelClaw ${VERSION} Installer
echo ============================================
echo.

REM Find the VSIX file
for %%f in (*.vsix) do (
    echo Installing %%f into VS Code...
    code --install-extension "%%f"
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install extension.
        echo Make sure VS Code is installed and 'code' is in your PATH.
        pause
        exit /b 1
    )
    echo.
    echo SUCCESS: PixelClaw extension installed!
    echo.
    echo Open VS Code and look for the Pixel Agents panel in the bottom panel area.
    echo.
    pause
    exit /b 0
)

echo ERROR: No .vsix file found in this directory.
pause
exit /b 1
`;
fs.writeFileSync(path.join(STAGING_DIR, "install.bat"), installBat, "ascii");
console.log("  Created install.bat");

// Create uninstall.bat
const uninstallBat = `@echo off
echo Uninstalling PixelClaw extension...
code --uninstall-extension pablodelucca.pixel-agents
echo Done.
pause
`;
fs.writeFileSync(path.join(STAGING_DIR, "uninstall.bat"), uninstallBat, "ascii");
console.log("  Created uninstall.bat");

// Create ZIP using PowerShell
const zipPath = path.join(RELEASES_DIR, ZIP_NAME);
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

try {
    execSync(
        `powershell -Command "Compress-Archive -Path '${STAGING_DIR}\\*' -DestinationPath '${zipPath}' -Force"`,
        { stdio: "inherit" }
    );
    console.log(`\n  Created: releases/${ZIP_NAME}`);

    // Report sizes
    const vsixSize = (fs.statSync(path.join(RELEASES_DIR, vsixFile)).size / 1024).toFixed(0);
    const zipSize = (fs.statSync(zipPath).size / 1024).toFixed(0);
    console.log(`  VSIX size: ${vsixSize} KB`);
    console.log(`  ZIP  size: ${zipSize} KB\n`);
} catch (err) {
    console.error("  ERROR: Failed to create ZIP:", err.message);
    process.exit(1);
}

// Cleanup staging
fs.rmSync(STAGING_DIR, { recursive: true });
console.log("  Cleaned staging directory\n");
