# PixelClaw — Release & Deployment Action Plan

> **Version:** 0.1.0  
> **Status:** Implementation  
> **Last Updated:** 2026-03-01  
> **Target:** Windows releases, GitHub Releases, GitHub Pages

---

## Table of Contents

1. [Overview](#1-overview)
2. [Release Pipeline Architecture](#2-release-pipeline-architecture)
3. [GitHub Actions Workflows](#3-github-actions-workflows)
4. [Release Artifacts](#4-release-artifacts)
5. [GitHub Pages Deployment](#5-github-pages-deployment)
6. [Windows Build Scripts](#6-windows-build-scripts)
7. [Quality Gates](#7-quality-gates)
8. [Step-by-Step Release Process](#8-step-by-step-release-process)
9. [Repository Configuration](#9-repository-configuration)
10. [Troubleshooting](#10-troubleshooting)
11. [Playwright E2E Testing](#11-playwright-e2e-testing)
12. [LM Studio Integration](#12-lm-studio-integration)

---

## 1. Overview

PixelClaw releases are fully automated via GitHub Actions. Every tagged push produces:

| Artifact         | Format  | Contents                  | User Action                  |
| ---------------- | ------- | ------------------------- | ---------------------------- |
| **VSIX**         | `.vsix` | VS Code extension package | Install from VSIX in VS Code |
| **Windows ZIP**  | `.zip`  | VSIX + install.bat + docs | Extract → run install.bat    |
| **GitHub Pages** | HTML    | Architecture dashboard    | Visit URL in browser         |

### Release Flow

```
Developer pushes tag v0.1.0
    │
    ├─► CI Workflow (.github/workflows/ci.yml)
    │     ├─ TypeScript type check
    │     ├─ ESLint
    │     ├─ Build extension (esbuild --production)
    │     ├─ Build webview (Vite)
    │     ├─ Verify dist/ output
    │     └─ Smoke tests
    │
    ├─► Release Workflow (.github/workflows/release.yml)
    │     ├─ Install dependencies
    │     ├─ Sync version from tag into package.json
    │     ├─ Build extension + webview
    │     ├─ Package VSIX via @vscode/vsce
    │     ├─ Package Windows ZIP (VSIX + install.bat + docs)
    │     ├─ Create GitHub Release
    │     └─ Upload artifacts to Release
    │
    └─► Pages Workflow (.github/workflows/pages.yml)
          ├─ Copy docs/ to _site/
          └─ Deploy to GitHub Pages
```

---

## 2. Release Pipeline Architecture

### Directory Layout

```
PixelClaw/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI: lint, typecheck, build, test
│       ├── release.yml         # Release: build → VSIX → ZIP → GitHub Release
│       └── pages.yml           # Pages: deploy docs site
├── scripts/
│   ├── doctor.ps1              # Prerequisites checker
│   └── package-zip.js          # Windows ZIP packager
├── tests/
│   └── smoke/
│       └── run.js              # Smoke test suite
├── releases/                   # Build output (gitignored)
│   ├── pixelclaw-v0.1.0.vsix
│   └── pixelclaw-v0.1.0-win-x64.zip
└── docs/
    ├── ARCHITECTURE.md
    ├── pixelclaw-architecture.html  # → becomes GitHub Pages index
    └── ACTION_PLAN.md               # This document
```

### Artifact Sizes (Estimated)

| Artifact                 | Estimated Size |
| ------------------------ | -------------- |
| `extension.js` (bundled) | ~50–150 KB     |
| `webview/` (Vite build)  | ~200–500 KB    |
| `.vsix` package          | ~300–800 KB    |
| Windows ZIP              | ~500 KB–1.5 MB |

---

## 3. GitHub Actions Workflows

### 3.1 CI Workflow (`ci.yml`)

**Triggers:** Push to `main`/`develop`, PRs to `main`

| Step                   | Command                                       | Purpose                                 |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| Install extension deps | `cd extension && npm ci`                      | Clean install from lockfile             |
| Install webview deps   | `cd extension/webview-ui && npm ci`           | Clean install from lockfile             |
| Type check             | `npx tsc --noEmit`                            | Catch TypeScript errors                 |
| Lint                   | `npm run lint`                                | ESLint code quality                     |
| Build extension        | `node esbuild.js --production`                | Bundle extension.ts → dist/extension.js |
| Build webview          | `npx tsc -b && npx vite build`                | React → dist/webview/                   |
| Verify output          | Check dist/ files exist and have correct size | Catch silent build failures             |
| Smoke tests            | `node tests/smoke/run.js`                     | Validate project structure              |

### 3.2 Release Workflow (`release.yml`)

**Triggers:** Push tag matching `v*`

| Step                     | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| Extract version from tag | Parse `v0.1.0` → `0.1.0`                         |
| Install dependencies     | `npm ci` for both extension and webview          |
| Sync version             | Write tag version into `extension/package.json`  |
| Build                    | Production build of extension + webview          |
| Package VSIX             | `@vscode/vsce package` → `.vsix` file            |
| Package ZIP              | Bundle VSIX + install.bat + docs into `.zip`     |
| Create Release           | `softprops/action-gh-release` with all artifacts |

**Pre-release detection:** Tags containing `alpha`, `beta`, or `rc` are marked as pre-release.

### 3.3 Pages Workflow (`pages.yml`)

**Triggers:** Push to `main` when `docs/` changes, or manual dispatch

| Step                                                    | Purpose                                    |
| ------------------------------------------------------- | ------------------------------------------ |
| Copy `pixelclaw-architecture.html` → `_site/index.html` | Landing page                               |
| Copy `ARCHITECTURE.md`                                  | Markdown reference                         |
| Copy `README.md` + `LICENSE`                            | Project info                               |
| Create `404.html`                                       | Custom 404 page                            |
| Deploy via `actions/deploy-pages`                       | Publish to `ghenghis.github.io/PixelClaw/` |

---

## 4. Release Artifacts

### 4.1 VSIX Package

The `.vsix` file is a standard VS Code extension package. Users install it via:

```
VS Code → Ctrl+Shift+P → "Extensions: Install from VSIX…"
```

**Contents:**
- `dist/extension.js` — Bundled extension code
- `dist/webview/` — Built React UI
- `dist/assets/` — Pixel art sprites and tilesets
- `package.json` — Extension manifest
- `icon.png` — Extension icon

### 4.2 Windows ZIP

The ZIP is a "batteries-included" download for users who want a simple installer experience.

**Contents:**
```
pixelclaw-v0.1.0-win-x64/
├── pixelclaw-v0.1.0.vsix       # The extension package
├── install.bat                   # One-click installer
├── uninstall.bat                 # One-click uninstaller
├── README.md                     # Quick start guide
├── LICENSE                       # MIT license
└── docs/
    ├── ARCHITECTURE.md           # Full architecture reference
    └── pixelclaw-architecture.html  # Interactive dashboard
```

**install.bat behavior:**
1. Finds `*.vsix` in the current directory
2. Runs `code --install-extension <file>`
3. Reports success or error with clear messaging
4. No interactive prompts — fully automatic

---

## 5. GitHub Pages Deployment

### URL

```
https://ghenghis.github.io/PixelClaw/
```

### Site Structure

| URL Path           | Source File                        | Content                            |
| ------------------ | ---------------------------------- | ---------------------------------- |
| `/`                | `docs/pixelclaw-architecture.html` | Interactive architecture dashboard |
| `/ARCHITECTURE.md` | `docs/ARCHITECTURE.md`             | Full markdown architecture doc     |
| `/README.md`       | `README.md`                        | Project README                     |

### Setup Requirements

In the GitHub repo settings:

1. Go to **Settings → Pages**
2. Source: **GitHub Actions**
3. The `pages.yml` workflow handles deployment automatically

---

## 6. Windows Build Scripts

### 6.1 Doctor Script (`scripts/doctor.ps1`)

Checks all prerequisites before building:

```powershell
npm run doctor
```

**Checks:**
- Node.js ≥ 20
- npm ≥ 10
- VS Code CLI (`code` in PATH)
- Git
- Python (optional, for Gateway Phase 2)
- LM Studio (optional, for inference)
- Dependencies installed
- Build output present
- Port availability (7892, 1234)

### 6.2 Package ZIP Script (`scripts/package-zip.js`)

Creates the Windows distribution ZIP:

```powershell
npm run package:zip
```

Requires a `.vsix` in `releases/` first (run `npm run package`).

### 6.3 Full Release Build

```powershell
npm run release
```

Executes: `clean → install:all → build → package (VSIX) → package:zip`

---

## 7. Quality Gates

### Pre-Release Checks

| Gate                     | Tool                         | Enforcement                   |
| ------------------------ | ---------------------------- | ----------------------------- |
| **Type safety**          | `tsc --noEmit`               | CI blocks merge on failure    |
| **Code style**           | ESLint                       | CI blocks merge on failure    |
| **Build integrity**      | File existence + size checks | CI verifies dist/ output      |
| **Structure validation** | Smoke tests                  | CI warns on failure           |
| **Version sync**         | Release workflow             | Auto-syncs tag → package.json |

### Smoke Test Coverage

| Test                  | What It Validates                                            |
| --------------------- | ------------------------------------------------------------ |
| Project structure     | Root files exist (package.json, README, LICENSE, .gitignore) |
| Extension structure   | Source files, configs, build tooling all present             |
| Package.json validity | Valid JSON, correct `main` entry, VS Code engine version     |
| GitHub Actions        | All 3 workflow files exist                                   |
| Build scripts         | doctor.ps1 and package-zip.js exist                          |
| Build output          | dist/extension.js exists and is non-trivially sized          |
| Dependencies          | node_modules directories installed                           |
| Runtime               | Node.js version ≥ 20                                         |

---

## 8. Step-by-Step Release Process

### First-Time Setup

```powershell
# 1. Clone the repo
git clone https://github.com/Ghenghis/PixelClaw.git
cd PixelClaw

# 2. Check prerequisites
npm run doctor

# 3. Install all dependencies
npm run install:all

# 4. Build everything
npm run build

# 5. Run smoke tests
npm run test:smoke

# 6. Package VSIX locally (optional)
npm run package

# 7. Create Windows ZIP (optional)
npm run package:zip
```

### Creating a Release

```powershell
# 1. Ensure main branch is clean and tested
git checkout main
git pull

# 2. Update version in extension/package.json if needed
# (Release workflow auto-syncs from tag, but local builds use this)

# 3. Tag the release
git tag v0.1.0

# 4. Push tag — this triggers the Release workflow
git push origin v0.1.0

# 5. GitHub Actions will:
#    - Build everything
#    - Package VSIX + ZIP
#    - Create a GitHub Release with both artifacts
#    - Update GitHub Pages
```

### Hotfix Release

```powershell
git checkout main
# make fix
git commit -am "fix: description of fix"
git tag v0.1.1
git push origin main --tags
```

### Pre-Release (Alpha/Beta)

```powershell
git tag v0.2.0-alpha.1
git push origin v0.2.0-alpha.1
# Release workflow marks this as pre-release automatically
```

---

## 9. Repository Configuration

### Required GitHub Settings

| Setting                 | Location                     | Value                                               |
| ----------------------- | ---------------------------- | --------------------------------------------------- |
| **Pages source**        | Settings → Pages             | GitHub Actions                                      |
| **Branch protection**   | Settings → Branches → main   | Require CI to pass                                  |
| **Actions permissions** | Settings → Actions → General | Allow all actions                                   |
| **Pages permissions**   | Workflow `pages.yml`         | `contents: read`, `pages: write`, `id-token: write` |
| **Release permissions** | Workflow `release.yml`       | `contents: write`                                   |

### Secrets (None Required)

The release pipeline uses no secrets. All builds are public and use `GITHUB_TOKEN` (automatically provided by Actions).

If Claude API integration is added later, add `ANTHROPIC_API_KEY` as a repository secret for integration tests.

---

## 10. Troubleshooting

### Build Fails: "Cannot find module"

```powershell
# Clean install
npm run clean
npm run install:all
npm run build
```

### VSIX Packaging Fails

```powershell
# Ensure vsce is available
npx @vscode/vsce --version

# Check extension/package.json has required fields:
# - name, displayName, version, publisher, engines.vscode, main
```

### GitHub Pages Not Deploying

1. Check Settings → Pages → Source is set to **GitHub Actions**
2. Check the `pages.yml` workflow run in Actions tab
3. Ensure `docs/pixelclaw-architecture.html` exists in the repo

### Windows ZIP Missing Files

```powershell
# Ensure VSIX exists first
npm run package

# Then create ZIP
npm run package:zip

# Check releases/ directory
Get-ChildItem releases/
```

### Smoke Tests Fail

```powershell
# Run with verbose output
node tests/smoke/run.js

# Fix any [FAIL] items reported
# Common: missing node_modules → npm run install:all
# Common: no build output → npm run build
```

### Release Tag Already Exists

```powershell
# Delete local and remote tag
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0

# Re-tag and push
git tag v0.1.0
git push origin v0.1.0
```

---

## Appendix: Release Checklist

Before pushing a release tag, verify:

- [ ] All changes committed to `main`
- [ ] `npm run doctor` passes (no FAIL items)
- [ ] `npm run build` succeeds
- [ ] `npm run test:smoke` passes
- [ ] `npm run package` creates a `.vsix` in `releases/`
- [ ] Version in `extension/package.json` is correct
- [ ] CHANGELOG.md updated (if applicable)
- [ ] Tag name follows semver: `v0.1.0`, `v0.2.0-beta.1`, etc.

---

## 11. Playwright E2E Testing

### Overview

PixelClaw uses **Playwright** for comprehensive end-to-end testing across four test projects:

| Project             | File Pattern     | What It Tests                                                                                   |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `lm-studio-api`     | `lmstudio.*.ts`  | LM Studio server health, chat completions, streaming, tool calling, error handling, performance |
| `build-integrity`   | `build.*.ts`     | Extension bundle validity, webview output, assets, package manifest                             |
| `release-artifacts` | `release.*.ts`   | VSIX integrity, ZIP contents, naming conventions                                                |
| `extension-e2e`     | `extension.*.ts` | `.pixelclaw.yaml` config, env vars, source integrity, workflow files, documentation             |

### Test Directory Structure

```
tests/
├── package.json              # Playwright + @types/node
├── tsconfig.json             # TypeScript config for tests
├── playwright.config.ts      # Playwright configuration
├── e2e/
│   ├── lmstudio.api.ts       # LM Studio API tests (7 tests)
│   ├── build.integrity.ts    # Build output validation (7 tests)
│   ├── release.artifacts.ts  # Release artifact tests (6 tests)
│   └── extension.config.ts   # Config & integration tests (12 tests)
└── smoke/
    └── run.js                # Quick smoke tests (29 tests)
```

### Running E2E Tests

```powershell
# Install test dependencies (first time only)
cd tests && npm install --include=dev
npx playwright install chromium

# Run all non-LM-Studio tests
npm run test:e2e -- --project=build-integrity --project=extension-e2e --project=release-artifacts

# Run LM Studio API tests (requires LM Studio running)
npm run test:e2e -- --project=lm-studio-api

# Run all tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# View last HTML report
npm run test:e2e:report
```

### LM Studio E2E Test Coverage

| Test                | Action                                    | Expected Reaction                                                  |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| **Server health**   | `GET /api/v1/models`                      | Returns loaded model list including `nerdstking-python-coder-7b-i` |
| **OpenAI compat**   | `GET /v1/models`                          | Same response via OpenAI-compatible endpoint                       |
| **Chat completion** | `POST /v1/chat/completions`               | Valid response with `choices[0].message.content` and `usage` stats |
| **Streaming**       | `POST /v1/chat/completions` (stream=true) | SSE formatted response with `data:` chunks                         |
| **Tool calling**    | `POST /v1/chat/completions` with tools    | Model calls `get_weather` function or provides text fallback       |
| **Invalid model**   | Request with nonexistent model ID         | Returns 400/404 error                                              |
| **Empty messages**  | Request with empty messages array         | Returns 400/422/500 error                                          |
| **Performance**     | Simple prompt with timing                 | Responds within 30 seconds, reports tokens/sec                     |

### GitHub Actions E2E Workflow

The `e2e.yml` workflow runs automatically on push/PR and contains three jobs:

1. **Build Integrity & Config E2E** — Always runs. Builds extension, then validates output.
2. **LM Studio API E2E** — Only runs via `workflow_dispatch` with a `lm_studio_url` input.
3. **Release Artifacts E2E** — Runs after build tests pass. Packages VSIX + ZIP, then validates.

---

## 12. LM Studio Integration

### Current Configuration

| Setting               | Value                                     |
| --------------------- | ----------------------------------------- |
| **LM Studio Version** | 0.4.x                                     |
| **Server URL**        | `http://100.117.198.97:1234`              |
| **Model**             | `nerdstking/nerdstking-python-coder-7b-i` |
| **Format**            | GGUF                                      |
| **Quantization**      | Q7                                        |
| **Architecture**      | llama (gem2)                              |
| **Domain**            | llm                                       |
| **Size on disk**      | 8.10 GB                                   |
| **Capabilities**      | Tool use                                  |
| **Parallel slots**    | 4                                         |
| **Idle TTL**          | 3600 min                                  |

### LM Studio 0.4.x API Layers

LM Studio exposes **three API layers** — each with different request/response formats:

| Layer                    | Base Path      | Request Format               | Docs                                                                                               |
| ------------------------ | -------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **Native REST API**      | `/api/v1/*`    | `input` (string), `output[]` | [lmstudio.ai/docs/developer/rest](https://lmstudio.ai/docs/developer/rest)                         |
| **OpenAI-compatible**    | `/v1/*`        | `messages[]`, `choices[]`    | [lmstudio.ai/docs/developer/openai-compat](https://lmstudio.ai/docs/developer/openai-compat)       |
| **Anthropic-compatible** | `/v1/messages` | Anthropic Messages format    | [lmstudio.ai/docs/developer/anthropic-compat](https://lmstudio.ai/docs/developer/anthropic-compat) |

### Supported Endpoints — Native REST API (`/api/v1/*`)

| Method | Endpoint                                 | Purpose                             |
| ------ | ---------------------------------------- | ----------------------------------- |
| `GET`  | `/api/v1/models`                         | List loaded models                  |
| `POST` | `/api/v1/chat`                           | Chat with MCP, stateful chats, etc. |
| `POST` | `/api/v1/models/load`                    | Load a model to memory              |
| `POST` | `/api/v1/models/unload`                  | Unload a model from memory          |
| `POST` | `/api/v1/models/download`                | Download a model                    |
| `GET`  | `/api/v1/models/download/status/:job_id` | Check download progress             |

**Native `/api/v1/chat` key differences from OpenAI:**
- Uses `input` (string) instead of `messages` (array)
- Uses `max_output_tokens` instead of `max_tokens`
- Uses `system_prompt` (string) instead of system role message
- Uses `integrations` for MCP tool calling (not `tools`)
- Returns `output[]` array (not `choices[]`), `stats` (not `usage`), `response_id`

### Supported Endpoints — OpenAI-Compatible (`/v1/*`)

| Method | Endpoint               | Purpose                        |
| ------ | ---------------------- | ------------------------------ |
| `GET`  | `/v1/models`           | List models (OpenAI format)    |
| `POST` | `/v1/chat/completions` | Chat completions               |
| `POST` | `/v1/responses`        | Responses API (new in 0.3.29+) |
| `POST` | `/v1/completions`      | Text completions               |
| `POST` | `/v1/embeddings`       | Text embeddings                |

**Supported `/v1/chat/completions` params:** `model`, `messages`, `temperature`, `max_tokens`, `stream`, `top_p`, `top_k`, `stop`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `repeat_penalty`, `seed`

### New Features in 0.4.x

#### Stateful Chats
Conversations persist server-side. Use `response_id`/`previous_response_id` to continue chats without resending history:
```bash
# First request returns response_id
curl http://localhost:1234/api/v1/chat -d '{"model":"...","input":"My name is Alice."}'
# → {"response_id":"resp_abc123...","output":[...]}

# Follow-up references previous response
curl http://localhost:1234/api/v1/chat -d '{"model":"...","input":"What is my name?","previous_response_id":"resp_abc123..."}'
```

#### MCP via API
Models can call MCP tools during chat. Two modes:
- **Ephemeral MCP**: Define MCP servers per-request via `integrations` array
- **Plugin MCP**: Use pre-configured servers from `mcp.json` via `integrations: ["mcp/<server_label>"]`

Requires "Allow per-request MCPs" and/or "Allow calling servers from mcp.json" in Server Settings.

#### Authentication
API tokens via `Authorization: Bearer <token>` header. Enable "Require Authentication" in Server Settings, then create tokens in Manage Tokens.

#### `/v1/responses` Endpoint
OpenAI Responses API with stateful follow-ups (`previous_response_id`), streaming SSE, reasoning support (`reasoning.effort`), and MCP tool support.

### Required Server Settings

These settings must be configured in **LM Studio → Developer → Server Settings**:

| Setting                                 | Required    | Purpose                                      |
| --------------------------------------- | ----------- | -------------------------------------------- |
| **Serve on Local Network**              | Yes*        | Bind to LAN IP instead of localhost only     |
| **Enable CORS**                         | Yes         | Allow browser-based API clients              |
| **Require Authentication**              | Recommended | Protect API with Bearer tokens               |
| **Allow per-request MCPs**              | For MCP     | Enable ephemeral MCP servers in API requests |
| **Allow calling servers from mcp.json** | For MCP     | Enable pre-configured MCP plugins            |
| **Just in Time Model Loading**          | Optional    | Auto-load models on first request            |

\* Required for remote access from other machines (Tailscale, LAN, etc.)

### SDKs

| Language   | Package         | Install                     |
| ---------- | --------------- | --------------------------- |
| TypeScript | `@lmstudio/sdk` | `npm install @lmstudio/sdk` |
| Python     | `lmstudio`      | `pip install lmstudio`      |

```typescript
import { LMStudioClient } from "@lmstudio/sdk";
const client = new LMStudioClient();
const model = await client.llm.model("nerdstking-python-coder-7b-i");
const result = await model.respond("What is 2+2?");
console.log(result.content);
```

### Configuration File

The `.pixelclaw.yaml` at project root configures the LM Studio connection:

```yaml
provider:
  default: "lmstudio"
  lmstudio:
    base_url: "http://100.117.198.97:1234/v1"        # OpenAI-compatible
    native_url: "http://100.117.198.97:1234/api/v1"   # Native REST API
    model: "nerdstking-python-coder-7b-i"
    api_token_env: "LM_API_TOKEN"
    temperature: 0.7
    max_tokens: 4096
```

### Environment Variables

```bash
LM_STUDIO_URL=http://100.117.198.97:1234
LM_STUDIO_MODEL=nerdstking-python-coder-7b-i
LM_API_TOKEN=<your-api-token-if-auth-enabled>
```

See `env/.env.example` for all supported environment variables.

### Performance Baseline

From LM Studio Developer Logs:
- **Prompt eval**: ~20.50 ms/token (48.78 tokens/sec)
- **Eval**: ~13.11 ms/token (76.30 tokens/sec)
- **Total time**: ~374–597 ms for 28 tokens
- **Parallel slots**: 4 concurrent requests

### E2E Test Coverage

| Test File            | API Layer     | Tests                                                   |
| -------------------- | ------------- | ------------------------------------------------------- |
| `lmstudio.api.ts`    | OpenAI-compat | /v1/models, /v1/chat/completions, /v1/responses, errors |
| `lmstudio.native.ts` | Native REST   | /api/v1/chat, stateful chats, MCP, model mgmt, perf     |

Tests gracefully skip when LM Studio is unreachable (env-dependent).

---

## Appendix: Release Checklist

Before pushing a release tag, verify:

- [ ] All changes committed to `main`
- [ ] `npm run doctor` passes (no FAIL items)
- [ ] `npm run build` succeeds
- [ ] `npm run test:smoke` passes
- [ ] `npm run test:e2e` passes (build-integrity + extension-e2e)
- [ ] `npm run test:e2e:lmstudio` passes (when LM Studio is reachable)
- [ ] `npm run package` creates a `.vsix` in `releases/`
- [ ] Version in `extension/package.json` is correct
- [ ] CHANGELOG.md updated (if applicable)
- [ ] Tag name follows semver: `v0.1.0`, `v0.2.0-beta.1`, etc.

---

*This action plan is automatically maintained. Last generated: 2026-03-01.*
