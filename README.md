# PixelClaw

> **Local-first visual AI agent platform** — ZeroClaw + PixelAgents + LM Studio / Claude

[![CI](https://github.com/Ghenghis/PixelClaw/actions/workflows/ci.yml/badge.svg)](https://github.com/Ghenghis/PixelClaw/actions/workflows/ci.yml)
[![Release](https://github.com/Ghenghis/PixelClaw/actions/workflows/release.yml/badge.svg)](https://github.com/Ghenghis/PixelClaw/actions/workflows/release.yml)
[![Pages](https://github.com/Ghenghis/PixelClaw/actions/workflows/pages.yml/badge.svg)](https://ghenghis.github.io/PixelClaw/)

---

## What is PixelClaw?

PixelClaw is a unified AI agent platform that combines three systems into a production-grade development assistant:

| System | Role | Tech |
|---|---|---|
| **PixelAgents** | VS Code webview with animated pixel-art characters ("living office") | TypeScript / React / Vite |
| **ZeroClaw** | Rust-native agentic executor with tool orchestration | Rust CLI |
| **PixelClaw Gateway** | FastAPI bridge connecting UI ↔ Executor ↔ Providers | Python 3.11 |

The agent lives visually inside VS Code, executes real tasks via ZeroClaw, remembers context across sessions via SQLite-vec, and can use **any provider** — from a fully local LM Studio model on an RTX 3090 Ti to Claude via the Anthropic API — without changing any project code.

## Quick Start

### Option 1 — Download Release (Recommended)

1. Go to [Releases](https://github.com/Ghenghis/PixelClaw/releases/latest)
2. Download `pixelclaw-vX.X.X.vsix` (VS Code extension)
3. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX…** → select the file
4. Open any workspace → the PixelAgents panel appears in the bottom panel

### Option 2 — Download ZIP

1. Download `pixelclaw-vX.X.X-win-x64.zip` from [Releases](https://github.com/Ghenghis/PixelClaw/releases/latest)
2. Extract anywhere
3. Run `install.bat` to install the VSIX and set up configuration
4. Open VS Code

### Option 3 — Build from Source

```powershell
git clone https://github.com/Ghenghis/PixelClaw.git
cd PixelClaw
npm run install:all
npm run build
npm run package
```

The built `.vsix` will be in the `releases/` folder.

## Prerequisites

Run the doctor script to check your environment:

```powershell
npm run doctor
```

**Required:**
- Node.js ≥ 20
- npm ≥ 10
- VS Code ≥ 1.107.0

**Optional (for full agent functionality):**
- Python 3.11+ (Gateway)
- LM Studio (local inference)
- Rust toolchain (ZeroClaw development)

## Project Structure

```
PixelClaw/
├── extension/              # VS Code extension (PixelAgents fork)
│   ├── src/                # Extension TypeScript source
│   ├── webview-ui/         # React webview (Vite)
│   └── dist/               # Build output (gitignored)
├── gateway/                # FastAPI bridge service (Phase 2)
├── zeroclaw/               # Rust executor config (Phase 2)
├── docs/                   # Architecture docs + GitHub Pages
├── scripts/                # Build, release, and utility scripts
├── tests/                  # Smoke + integration tests
├── releases/               # Built artifacts (gitignored)
├── .github/workflows/      # CI, Release, Pages automation
└── package.json            # Root orchestration scripts
```

## Architecture

See the full [Architecture Document](docs/ARCHITECTURE.md) or the interactive [Architecture Dashboard](https://ghenghis.github.io/PixelClaw/).

## Development

```powershell
# Install everything
npm run install:all

# Build extension + webview
npm run build

# Lint
npm run lint

# Type check
npm run typecheck

# Run smoke tests
npm run test:smoke

# Full release build (clean → install → build → package)
npm run release
```

## Releases

Releases are automated via GitHub Actions. When a version tag is pushed:

1. **CI** runs lint, typecheck, and smoke tests
2. **Release** workflow builds the VSIX and Windows ZIP
3. Artifacts are uploaded to [GitHub Releases](https://github.com/Ghenghis/PixelClaw/releases)
4. **Pages** workflow deploys the documentation site

```powershell
# To create a release:
git tag v0.1.0
git push origin v0.1.0
```

## License

[MIT](LICENSE)

---

**PixelClaw** — _Your AI agent, alive in your editor._
