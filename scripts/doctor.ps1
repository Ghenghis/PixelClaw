# PixelClaw Doctor — Prerequisites Checker
# Run: pwsh -ExecutionPolicy Bypass -File scripts/doctor.ps1

$ErrorActionPreference = "Continue"
$pass = 0
$fail = 0
$warn = 0

function Check-OK($label, $detail) {
    Write-Host "  [OK]   " -ForegroundColor Green -NoNewline
    Write-Host "$label" -ForegroundColor White -NoNewline
    Write-Host " — $detail" -ForegroundColor DarkGray
    $script:pass++
}

function Check-FAIL($label, $detail) {
    Write-Host "  [FAIL] " -ForegroundColor Red -NoNewline
    Write-Host "$label" -ForegroundColor White -NoNewline
    Write-Host " — $detail" -ForegroundColor DarkGray
    $script:fail++
}

function Check-WARN($label, $detail) {
    Write-Host "  [WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host "$label" -ForegroundColor White -NoNewline
    Write-Host " — $detail" -ForegroundColor DarkGray
    $script:warn++
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PixelClaw Doctor" -ForegroundColor Cyan
Write-Host "  Prerequisites Check" -ForegroundColor DarkCyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Node.js ---
Write-Host "[Checking Node.js]" -ForegroundColor Cyan
try {
    $nodeVer = (node --version 2>$null)
    if ($nodeVer) {
        $major = [int]($nodeVer -replace '^v','').Split('.')[0]
        if ($major -ge 20) {
            Check-OK "Node.js" "$nodeVer (required >= 20)"
        } else {
            Check-FAIL "Node.js" "$nodeVer found but >= 20 required"
        }
    } else {
        Check-FAIL "Node.js" "not found — install from https://nodejs.org"
    }
} catch {
    Check-FAIL "Node.js" "not found — install from https://nodejs.org"
}

# --- npm ---
Write-Host "[Checking npm]" -ForegroundColor Cyan
try {
    $npmVer = (npm --version 2>$null)
    if ($npmVer) {
        $major = [int]$npmVer.Split('.')[0]
        if ($major -ge 10) {
            Check-OK "npm" "v$npmVer (required >= 10)"
        } else {
            Check-WARN "npm" "v$npmVer found, >= 10 recommended. Run: npm install -g npm@latest"
        }
    } else {
        Check-FAIL "npm" "not found"
    }
} catch {
    Check-FAIL "npm" "not found"
}

# --- VS Code ---
Write-Host "[Checking VS Code]" -ForegroundColor Cyan
try {
    $codeVer = (code --version 2>$null | Select-Object -First 1)
    if ($codeVer) {
        Check-OK "VS Code" "v$codeVer"
    } else {
        Check-WARN "VS Code" "'code' CLI not in PATH — install or add to PATH"
    }
} catch {
    Check-WARN "VS Code" "'code' CLI not in PATH"
}

# --- vsce (VS Code Extension Manager) ---
Write-Host "[Checking vsce]" -ForegroundColor Cyan
try {
    $vsceVer = (npx @vscode/vsce --version 2>$null)
    if ($vsceVer) {
        Check-OK "vsce" "v$vsceVer (for packaging VSIX)"
    } else {
        Check-WARN "vsce" "not cached — will be downloaded on first package"
    }
} catch {
    Check-WARN "vsce" "not cached — npx will download on first use"
}

# --- Git ---
Write-Host "[Checking Git]" -ForegroundColor Cyan
try {
    $gitVer = (git --version 2>$null)
    if ($gitVer) {
        Check-OK "Git" $gitVer
    } else {
        Check-FAIL "Git" "not found — install from https://git-scm.com"
    }
} catch {
    Check-FAIL "Git" "not found"
}

# --- Python (optional) ---
Write-Host "[Checking Python (optional)]" -ForegroundColor Cyan
try {
    $pyVer = (python --version 2>$null)
    if ($pyVer) {
        Check-OK "Python" "$pyVer (needed for Gateway in Phase 2)"
    } else {
        Check-WARN "Python" "not found — needed for Gateway (Phase 2)"
    }
} catch {
    Check-WARN "Python" "not found — needed for Gateway (Phase 2)"
}

# --- LM Studio (optional) ---
Write-Host "[Checking LM Studio (optional)]" -ForegroundColor Cyan
try {
    $lmsPath = "$env:USERPROFILE\.lmstudio"
    if (Test-Path $lmsPath) {
        Check-OK "LM Studio" "directory found at $lmsPath"
    } else {
        Check-WARN "LM Studio" "not detected — needed for local inference"
    }
} catch {
    Check-WARN "LM Studio" "not detected"
}

# --- Extension node_modules ---
Write-Host "[Checking Dependencies]" -ForegroundColor Cyan
$extNM = "extension/node_modules"
$webNM = "extension/webview-ui/node_modules"
if (Test-Path $extNM) {
    Check-OK "extension/node_modules" "installed"
} else {
    Check-WARN "extension/node_modules" "not installed — run: npm run install:all"
}
if (Test-Path $webNM) {
    Check-OK "webview-ui/node_modules" "installed"
} else {
    Check-WARN "webview-ui/node_modules" "not installed — run: npm run install:all"
}

# --- Build output ---
Write-Host "[Checking Build Output]" -ForegroundColor Cyan
if (Test-Path "extension/dist/extension.js") {
    Check-OK "extension/dist/extension.js" "built"
} else {
    Check-WARN "extension build" "not built yet — run: npm run build"
}
if (Test-Path "extension/dist/webview/index.html") {
    Check-OK "extension/dist/webview" "built"
} else {
    Check-WARN "webview build" "not built yet — run: npm run build"
}

# --- Port check ---
Write-Host "[Checking Ports]" -ForegroundColor Cyan
$port7892 = Get-NetTCPConnection -LocalPort 7892 -ErrorAction SilentlyContinue
if ($port7892) {
    Check-OK "Port 7892" "Gateway port is in use (Gateway may be running)"
} else {
    Check-WARN "Port 7892" "not in use (Gateway not running — expected before Phase 2)"
}
$port1234 = Get-NetTCPConnection -LocalPort 1234 -ErrorAction SilentlyContinue
if ($port1234) {
    Check-OK "Port 1234" "LM Studio is running"
} else {
    Check-WARN "Port 1234" "LM Studio not detected on port 1234"
}

# --- Summary ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Results: " -NoNewline -ForegroundColor Cyan
Write-Host "$pass passed" -ForegroundColor Green -NoNewline
Write-Host ", $warn warnings" -ForegroundColor Yellow -NoNewline
Write-Host ", $fail failed" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Cyan

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "  Fix the FAIL items above before building." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "  Environment is ready!" -ForegroundColor Green
    exit 0
}
