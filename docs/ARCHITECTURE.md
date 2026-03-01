# PixelClaw — Architecture Document

> **Version:** 0.1.0-planning  
> **Status:** Pre-build / Architecture Phase  
> **Last Updated:** 2026-03-01  
> **Stack:** Python (FastAPI) · TypeScript (VS Code Extension) · Rust (ZeroClaw) · SQLite-vec · LM Studio · Claude API

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Design Philosophy](#2-goals--design-philosophy)
3. [System Architecture](#3-system-architecture)
4. [Component Reference](#4-component-reference)
5. [Provider Abstraction Layer](#5-provider-abstraction-layer)
6. [Data Flow & Sequence Diagrams](#6-data-flow--sequence-diagrams)
7. [Memory & Persistence Layer](#7-memory--persistence-layer)
8. [Tool System & MCP Integration](#8-tool-system--mcp-integration)
9. [PixelAgents Animation Bridge](#9-pixelagents-animation-bridge)
10. [Security Model](#10-security-model)
11. [Per-Project Configuration](#11-per-project-configuration)
12. [Hardware Utilization (RTX 3090 Ti)](#12-hardware-utilization-rtx-3090-ti)
13. [Repo Structure](#13-repo-structure)
14. [Environment Variables](#14-environment-variables)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Key Decisions & Trade-offs](#16-key-decisions--trade-offs)
17. [Glossary](#17-glossary)

---

## 1. Overview

**PixelClaw** is a local-first, visual AI agent platform that combines three systems into a unified, production-grade development assistant:

| System | Role | Status |
|---|---|---|
| **PixelAgents** | VS Code webview with animated characters ("living office") | Exists — needs extension patches |
| **ZeroClaw** | Rust-native agentic executor with tool orchestration | Exists — needs subprocess wrapper |
| **PixelClaw Gateway** | FastAPI bridge service connecting all layers | **Must build — #1 blocker** |

The result is an AI agent that lives visually inside VS Code, executes real tasks via ZeroClaw, remembers context across sessions via SQLite-vec, and can use any provider — from a fully local LM Studio model on a 3090 Ti to Claude via the Anthropic API — without changing any project code. Switching providers is one line in `.pixelclaw.yaml`.

PixelClaw is also designed to be **universal across projects**: drop a `.pixelclaw.yaml` into any workspace root and the system auto-configures itself — different model, different tools, different memory namespace, different agent persona — all per project.

---

## 2. Goals & Design Philosophy

### Core Goals

- **Local-first by default.** LM Studio on the 3090 Ti is the default provider. No cloud dependency required for standard operation.
- **Zero-code provider switching.** Change `provider.default` in `.pixelclaw.yaml` to switch from LM Studio → Claude → any OpenAI-compatible endpoint.
- **Universal across all projects.** Works as a dev assistant in any VS Code workspace. Each project gets isolated memory, tools, and persona.
- **Real execution, not simulation.** ZeroClaw runs real commands. The system produces real artifacts, diffs, and file changes — not mock outputs.
- **Visual feedback loop.** PixelAgents characters animate in sync with agent activity. Thinking, working, idle, done, and error states all have visual representations.
- **Claude Desktop / Claude Code compatible.** The Gateway exposes a standard MCP endpoint, making all tools available inside Claude Desktop with zero additional code.

### Non-Goals (v0.1)

- Multi-tenant / SaaS operation
- Browser-based UI (VS Code extension only)
- Windows GUI installer (scripts-based setup for now)
- Paid external API dependencies for core functionality

---

## 3. System Architecture

### Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — PRESENTATION                                                     │
│  PixelAgents VS Code Extension (TypeScript / Webview)                       │
│  • Animated character display       • Chat input panel                      │
│  • Task history panel               • Provider + tool status indicators     │
│  • Per-project config detection     • Claude Code command bridge            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ WebSocket (ws://localhost:7892/ws/chat)
                               │ REST (http://localhost:7892/*)
┌──────────────────────────────▼──────────────────────────────────────────────┐
│  LAYER 2 — GATEWAY (must build)                                             │
│  PixelClaw Gateway — FastAPI + Uvicorn (Python 3.11)                        │
│  • Provider Router              • Tool Dispatcher                           │
│  • JSONL Emitter                • MCP Host (stdio servers)                  │
│  • Memory Manager               • Task Queue (SQLite)                       │
│  • /health endpoint             • /mcp endpoint (Claude Desktop)            │
└───────┬─────────────────────────────┬───────────────────────────────────────┘
        │                             │
        ▼                             ▼
┌───────────────────┐   ┌─────────────────────────────────────────────────────┐
│  LAYER 3 — EXEC   │   │  LAYER 4 — PROVIDERS                               │
│  ZeroClaw (Rust)  │   │                                                     │
│  • Tool runner    │   │  ┌─────────────────┐  ┌──────────────────────────┐ │
│  • Task agent     │   │  │  LM Studio       │  │  Claude API (optional)   │ │
│  • JSON output    │   │  │  localhost:1234  │  │  api.anthropic.com       │ │
│  • Subprocess     │   │  │  (DEFAULT)       │  │  claude-sonnet-4-6       │ │
│  • Cancellation   │   │  │  Llama / Qwen    │  │  claude-opus-4-6         │ │
└───────────────────┘   │  │  Mistral / etc.  │  └──────────────────────────┘ │
                        │  └─────────────────┘                                │
                        │  ┌─────────────────┐  ┌──────────────────────────┐ │
                        │  │  Claude Code     │  │  OpenAI-compatible       │ │
                        │  │  (VS Code ext.)  │  │  (any base_url)          │ │
                        │  │  Optional bridge │  │  Fallback / 3rd party    │ │
                        │  └─────────────────┘  └──────────────────────────┘ │
                        └─────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — PERSISTENCE                                                    │
│  SQLite-vec  (memory.db)           SQLite  (tasks.db)                     │
│  • Vector memory per project       • Task log / history                   │
│  • Embedding via nomic-embed-text  • Session records                      │
│  • Cosine similarity retrieval     • Tool execution log                   │
│  • Per-namespace isolation         • Error log                            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  LAYER 6 — MCP SERVERS (subprocess, managed by Gateway)                   │
│  @mcp/server-filesystem   @mcp/server-git   @mcp/server-fetch             │
│  Custom ZeroClaw MCP      Project-specific MCPs (per .pixelclaw.yaml)     │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Reference

### 4.1 PixelClaw Gateway

**Location:** `gateway/`  
**Runtime:** Python 3.11, FastAPI, Uvicorn  
**Port:** `7892` (default, env-configurable)

The Gateway is the central nervous system. Every request from the VS Code extension flows through it. It handles provider routing, tool dispatch, memory read/write, JSONL animation emission, and exposes an MCP endpoint for Claude Desktop integration.

**Key modules:**

| Module | Path | Responsibility |
|---|---|---|
| App entrypoint | `gateway/main.py` | FastAPI app, middleware, startup |
| Provider Router | `gateway/providers/router.py` | LM Studio / Claude / OpenAI abstraction |
| ZeroClaw Tool | `gateway/tools/zeroclaw_tool.py` | Subprocess wrapper with timeout + JSON capture |
| MCP Host | `gateway/tools/mcp_host.py` | Spawn and manage stdio MCP server processes |
| Memory Store | `gateway/memory/store.py` | SQLite-vec read/write/retrieve |
| Embedding Client | `gateway/memory/embedder.py` | nomic-embed-text via LM Studio /embeddings |
| JSONL Emitter | `gateway/jsonl_emitter.py` | Write animation events to PixelAgents watch folder |
| Config Loader | `gateway/config.py` | Load + validate `.pixelclaw.yaml` per workspace |
| Task Queue | `gateway/tasks/queue.py` | SQLite-backed async task log |

**API Surface:**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health + provider status |
| `/ws/chat` | WebSocket | Streaming chat with tool dispatch |
| `/api/tasks` | GET | Task history for current project |
| `/api/tasks/{id}` | GET | Single task detail |
| `/api/providers` | GET | Available providers + active model |
| `/api/tools` | GET | Registered tools and enabled state |
| `/api/memory` | GET | Recent memory entries for project |
| `/mcp` | HTTP+SSE | MCP endpoint for Claude Desktop |

---

### 4.2 ZeroClaw Runner

**Location:** `zeroclaw/` (binary or submodule)  
**Runtime:** Rust  
**Interface:** CLI subprocess via `asyncio.create_subprocess_exec`

ZeroClaw is the execution engine. It manages tool calls, file operations, shell commands, and multi-step task orchestration. The Gateway wraps it as an async Python subprocess with structured JSON output capture, timeout enforcement, and graceful cancellation.

**Gateway wrapper responsibilities:**
- Inject per-project `config.toml` (provider base_url, model, API key)
- Capture stdout as structured JSON events (one JSON object per line)
- Stream progress events to the JSONL emitter during execution
- Kill process cleanly on timeout or user cancellation
- Log all executions to `tasks.db`

**Required ZeroClaw output format (structured mode):**

```json
{"event": "start",    "task": "...", "ts": "..."}
{"event": "tool_use", "tool": "...", "input": {...}, "ts": "..."}
{"event": "progress", "text": "...", "ts": "..."}
{"event": "done",     "result": "...", "ts": "..."}
{"event": "error",    "message": "...", "ts": "..."}
```

If ZeroClaw does not natively support `--json-output`, the wrapper includes a stdout parser that converts human-readable output into the above schema.

---

### 4.3 PixelAgents Extension

**Location:** `extension/` (fork of `pablodelucca/pixel-agents`)  
**Runtime:** TypeScript, VS Code Extension API, Vite webview  

**Patches required:**
1. **Gateway connection panel** — host/port settings, reconnect button, status indicator in VS Code status bar
2. **Workspace detection** — on `workspaceFolders` change, send workspace path to Gateway; Gateway auto-loads `.pixelclaw.yaml`
3. **WebSocket client** — replace any hardcoded provider calls with Gateway WebSocket stream
4. **Task history panel** — pull from `GET /api/tasks` and render in side panel
5. **Provider selector** — dropdown to override provider for current session
6. **Claude Code bridge** — `vscode.commands.executeCommand` to invoke Claude Code from PixelAgent chat

---

### 4.4 MCP Server Host

**Location:** `gateway/tools/mcp_host.py`  
**Runtime:** Node.js child processes, managed by Python subprocess

The Gateway spawns and manages MCP server processes. Each server communicates via stdio (standard MCP transport). The Gateway translates between provider tool-call format (OpenAI function-calling schema) and MCP tool schemas.

**Default MCP servers:**

| Server | NPM Package | Provides |
|---|---|---|
| Filesystem | `@modelcontextprotocol/server-filesystem` | File read, write, list, search |
| Git | `@modelcontextprotocol/server-git` | Status, diff, commit, log |
| Fetch | `@modelcontextprotocol/server-fetch` | HTTP GET for web content |
| ZeroClaw MCP | Custom (built in Phase 2) | ZeroClaw tasks as MCP tools |

Per-project MCP servers are declared in `.pixelclaw.yaml` under `tools.mcp_servers`.

---

## 5. Provider Abstraction Layer

The Provider Router presents a unified async interface to the rest of the Gateway. Callers never import LM Studio or Anthropic clients directly.

```python
# Unified interface — all providers implement this
class BaseProvider(Protocol):
    async def stream(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        system: str | None,
    ) -> AsyncIterator[str]: ...

    async def embed(self, text: str) -> list[float]: ...
    async def health(self) -> bool: ...
```

### Provider Implementations

#### LM Studio (Default)

```python
# Uses openai SDK pointed at localhost
client = AsyncOpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio"  # required field, value ignored
)
```

- **Model selection:** Configured in `.pixelclaw.yaml` → `provider.lmstudio.model`
- **Embeddings:** Separate model — `provider.lmstudio.embed_model` (default: `nomic-embed-text`)
- **Tool calling:** Supported by most recent GGUF models with function-calling metadata
- **Streaming:** Full SSE streaming via `stream=True`

#### Claude API (Optional)

```python
client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
```

- **Model selection:** `provider.claude.model` (default: `claude-sonnet-4-6`)
- **Tool calling:** Native Anthropic tool-use API — mapped from MCP tool schemas
- **Embeddings:** Claude does not provide embeddings; falls back to LM Studio embed model even when Claude is the chat provider
- **Streaming:** Native streaming via `stream=True`

#### Claude Desktop (MCP Consumer)

When the Gateway's `/mcp` endpoint is registered in `claude_desktop_config.json`, Claude Desktop becomes a **consumer** of PixelClaw tools. This is the inverse of the normal flow:

```
Normal:  VS Code Extension → Gateway → Provider (LM Studio/Claude)
Desktop: Claude Desktop → Gateway /mcp → ZeroClaw / Filesystem / Memory
```

Zero additional code is needed once the Gateway exposes `/mcp` (Phase 2).

### Provider Routing Rules

```yaml
# Priority order when provider = "auto"
routing:
  complex_reasoning:  claude      # multi-step planning
  tool_calls:         lmstudio    # fast Mistral 7B for tool dispatch
  embeddings:         lmstudio    # always local, always nomic-embed-text
  code_generation:    lmstudio    # Qwen 2.5 Coder 32B
  fallback:           lmstudio    # if cloud provider unreachable
```

---

## 6. Data Flow & Sequence Diagrams

### 6.1 Standard Chat Request

```
User (VS Code)
    │
    │  WebSocket send: { "text": "summarize my project", "workspace": "/path/to/proj" }
    ▼
Gateway /ws/chat
    │
    ├─► Config Loader: load /path/to/proj/.pixelclaw.yaml
    │       └─► resolve provider, tools, memory namespace
    │
    ├─► Memory Store: retrieve(text, namespace="proj-v1", top_k=5)
    │       └─► embed(text) via LM Studio /embeddings
    │       └─► SQLite-vec cosine search → return top 5 memory chunks
    │
    ├─► JSONL Emitter: emit("thinking", text)
    │       └─► write event to pixelagents/events/events.jsonl
    │       └─► PixelAgents watches folder → character walks to desk
    │
    ├─► Provider Router: stream(messages + memory context, tools)
    │       └─► [LM Studio] POST /v1/chat/completions stream=True
    │             OR
    │       └─► [Claude] client.messages.stream(...)
    │
    ├─► [If provider calls a tool]
    │       └─► Tool Dispatcher: dispatch(tool_name, tool_input)
    │             ├─► ZeroClaw: subprocess run, capture JSON output
    │             ├─► MCP server: stdio call → response
    │             └─► Return tool result → inject into message stream
    │
    ├─► Stream response chunks back to VS Code extension
    │       └─► ws.send_json({"delta": chunk})
    │
    ├─► Memory Store: store(exchange, namespace)
    │       └─► embed(user+assistant turn)
    │       └─► upsert into SQLite-vec
    │
    ├─► Task Queue: log_task(task_id, status="done", result=...)
    │
    └─► JSONL Emitter: emit("idle", "")
            └─► PixelAgents character returns to idle animation
```

### 6.2 ZeroClaw Tool Execution Sub-Flow

```
Tool Dispatcher receives: { "tool": "zeroclaw_runner", "input": { "task": "..." } }
    │
    ├─► ZeroClawTool.run(task, project_dir, timeout=120s)
    │
    ├─► asyncio.create_subprocess_exec("zeroclaw", "agent", "-m", task, "--json-output")
    │       cwd = project_dir
    │
    ├─► JSONL Emitter: emit("working", task)   ← character starts typing animation
    │
    ├─► Stream stdout line by line:
    │       {"event":"tool_use","tool":"write_file","input":{"path":"..."},"ts":"..."}
    │           └─► JSONL Emitter: emit("working", "write_file")
    │       {"event":"progress","text":"Writing 142 lines...","ts":"..."}
    │           └─► Forward progress to WebSocket client
    │       {"event":"done","result":"File written successfully","ts":"..."}
    │
    ├─► On timeout: proc.kill() → return {"error":"timeout","task":task}
    │
    └─► Return final result dict to Provider Router (injected as tool_result message)
```

---

## 7. Memory & Persistence Layer

### 7.1 Storage Files

| File | Engine | Contents |
|---|---|---|
| `data/memory.db` | SQLite + sqlite-vec extension | Vector embeddings + metadata per namespace |
| `data/tasks.db` | SQLite | Task log, session records, tool execution log |
| `pixelagents/events/events.jsonl` | JSONL append-only | Animation trigger events (rotated daily) |

### 7.2 SQLite-vec Schema

```sql
-- memory.db

CREATE TABLE memories (
    id          TEXT PRIMARY KEY,
    namespace   TEXT NOT NULL,           -- project namespace from .pixelclaw.yaml
    content     TEXT NOT NULL,           -- original text chunk
    role        TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool_result'
    embedding   BLOB NOT NULL,           -- float32[] stored as blob (sqlite-vec format)
    session_id  TEXT,
    created_at  TEXT NOT NULL,
    ttl_days    INTEGER DEFAULT 30,
    metadata    TEXT                     -- JSON: tool name, task id, etc.
);

CREATE VIRTUAL TABLE memories_vec USING vec0(
    embedding float[768]                 -- nomic-embed-text produces 768-dim vectors
);
```

### 7.3 Retrieval Strategy

On each incoming request:

1. Embed the incoming user message via LM Studio (`nomic-embed-text`, 768 dim)
2. Query `memories_vec` for top-k (default 5) cosine-similar entries in the current project namespace
3. Inject retrieved chunks as a `system` prefix: `"Relevant context from past sessions: ..."`
4. After response is complete, embed the full exchange and upsert into `memories`

Memory is **namespace-isolated**: each project's `.pixelclaw.yaml` declares a `project.namespace` string. Entries from project A never appear in retrieval for project B.

### 7.4 Task Log Schema

```sql
-- tasks.db

CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    namespace   TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    tools_used  TEXT,                    -- JSON array of tool names
    status      TEXT NOT NULL,           -- 'pending' | 'running' | 'done' | 'error' | 'timeout'
    result      TEXT,
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER
);
```

---

## 8. Tool System & MCP Integration

### 8.1 Tool Registration

Tools are registered in the Gateway's tool registry at startup. Each tool implements:

```python
class BaseTool(Protocol):
    name: str
    description: str
    input_schema: dict        # JSON Schema for function-calling

    async def call(self, input: dict) -> dict: ...
    async def health(self) -> bool: ...
```

### 8.2 Tool → Provider Mapping

The Provider Router translates the tool registry into provider-specific format:

- **LM Studio / OpenAI:** Tools → `tools` array in `/v1/chat/completions` (function-calling format)
- **Claude API:** Tools → `tools` array in Messages API (Anthropic format with `input_schema`)

The translation is automatic. Tools are defined once; the router handles format conversion.

### 8.3 MCP Host Operation

```
Gateway startup:
    for each mcp_server in .pixelclaw.yaml:
        proc = subprocess.Popen(
            ["npx", "-y", server_package, ...args],
            stdin=PIPE, stdout=PIPE, stderr=PIPE
        )
        client = mcp.StdioClient(proc.stdin, proc.stdout)
        tools = await client.list_tools()
        register tools in Gateway tool registry

On shutdown:
    for each proc: proc.terminate(); proc.wait(timeout=5)
```

### 8.4 Claude Desktop MCP Registration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pixelclaw": {
      "url": "http://localhost:7892/mcp",
      "type": "http"
    }
  }
}
```

After this, Claude Desktop has access to all registered PixelClaw tools (ZeroClaw tasks, filesystem, git, etc.) in any conversation.

---

## 9. PixelAgents Animation Bridge

### 9.1 JSONL Event Schema

The Gateway writes animation events to a watched folder. PixelAgents reads this file on a polling interval and triggers character animations.

```json
{
  "ts":    "2026-03-01T10:00:00.000Z",
  "type":  "thinking",
  "anim":  "walk_to_desk",
  "text":  "Summarize my project structure",
  "tool":  null,
  "ms":    null
}
```

### 9.2 Event Type → Animation Mapping

| Event Type | Animation | Trigger Condition |
|---|---|---|
| `thinking` | `walk_to_desk` | User prompt received, retrieving memory |
| `working` | `typing` | Provider is generating / tool is executing |
| `tool_call` | `open_file` or `typing` | ZeroClaw or MCP tool called |
| `reading` | `look_at_screen` | Provider is reading context / searching |
| `done` | `stretch` | Task fully complete |
| `idle` | `idle_loop` | No active task |
| `error` | `confused` | Error or timeout occurred |

### 9.3 Watch Folder Location

Default: `{gateway_data_dir}/events/events.jsonl`

The PixelAgents extension is patched to watch this path (configurable via VS Code settings: `pixelclaw.eventsPath`). Events older than 5 seconds are ignored to prevent replaying stale animations on reload.

---

## 10. Security Model

### 10.1 Secrets

- **No secrets in source code.** All API keys come from `.env` which is gitignored.
- `.env.example` documents all required/optional variables with safe placeholder values.
- The Gateway reads secrets via `python-dotenv` at startup. Missing required secrets cause startup failure with a clear error message.

### 10.2 Risky Surfaces

| Surface | Risk | Mitigation |
|---|---|---|
| ZeroClaw subprocess | Arbitrary shell command execution | Only Gateway can invoke it. Input sanitized. Per-project cwd enforced. |
| MCP filesystem server | File read/write to project directory | Root path restricted to workspace dir from `.pixelclaw.yaml` |
| MCP fetch server | Arbitrary HTTP requests | Allowlist-only mode configurable in per-project config |
| LM Studio local API | Any process on localhost can call it | Gateway is the only caller; LM Studio bind address should be `127.0.0.1` |
| JSONL events file | Local filesystem write | Events folder is inside Gateway data dir, not exposed externally |
| Claude API key | Cloud credential | `.env` only, secret-scanned in CI via gitleaks |

### 10.3 CI Security Checks

```yaml
security:
  - gitleaks (secret scanning on every push)
  - pip-audit -r gateway/requirements.txt (Python dependency CVEs)
  - npm audit --audit-level=high (Node dependency CVEs)
  - bandit -r gateway/ (Python static security analysis)
```

---

## 11. Per-Project Configuration

Every VS Code workspace can have a `.pixelclaw.yaml` at its root. If not present, Gateway falls back to `gateway/config/global.yaml`.

### Full Schema

```yaml
# .pixelclaw.yaml
# PixelClaw per-project configuration

project:
  name: "my-project"
  namespace: "my-project-v1"         # memory isolation key — change to reset memory
  description: "Optional project description shown in VS Code panel"

provider:
  default: "lmstudio"                # lmstudio | claude | openai | auto
  lmstudio:
    base_url: "http://localhost:1234/v1"
    model: "llama-3.3-70b-instruct"
    embed_model: "nomic-embed-text"
    temperature: 0.7
    max_tokens: 4096
  claude:
    model: "claude-sonnet-4-6"       # claude-sonnet-4-6 | claude-opus-4-6 | claude-haiku-4-5
    api_key_env: "ANTHROPIC_API_KEY"
    temperature: 0.7
    max_tokens: 8192
  override_provider: null            # force a provider regardless of default

tools:
  zeroclaw: true
  filesystem: true
  git: true
  fetch: false                       # disabled by default (requires allowlist)
  fetch_allowlist: []                # ["example.com", "docs.python.org"]
  mcp_servers:
    - "filesystem"
    - "git"
    # - "custom-server-name"         # additional MCP servers from mcp-servers/servers.json

memory:
  enabled: true
  top_k: 5                           # retrieve top N memories per request
  max_tokens: 4096                   # max tokens injected as memory context
  ttl_days: 30                       # auto-expire memories older than N days
  embed_batch_size: 8

persona:
  name: "Dev Assistant"
  avatar: "pixel_coder"              # PixelAgents character identifier
  system_prompt: |
    You are a senior software engineer assisting with this project.
    You use ZeroClaw to execute tasks and always prefer making real
    changes over providing instructions only.
```

---

## 12. Hardware Utilization (RTX 3090 Ti)

The RTX 3090 Ti with 24GB VRAM is the reference hardware for PixelClaw's default configuration.

### Recommended Model Strategy

| Slot | Model | VRAM | Purpose | Speed |
|---|---|---|---|---|
| Primary | Llama 3.3 70B Q4_K_M | ~20 GB | Complex reasoning, planning | 15–20 t/s |
| Primary (alt) | Qwen 2.5 72B Q4_K_M | ~20 GB | Code generation tasks | 15 t/s |
| Fast | Mistral 7B Q8_0 | ~8 GB | Tool dispatch, quick answers | 60+ t/s |
| Fast (alt) | Qwen 2.5 Coder 32B Q5_K_M | ~22 GB | Code-heavy projects | 20 t/s |
| Embeddings | nomic-embed-text | ~0.3 GB | Memory layer (always loaded) | Instant |

> **Recommended LM Studio setup:** Load `nomic-embed-text` permanently. Load either `Mistral 7B Q8` (fast) or `Llama 3.3 70B Q4` (quality) for inference. The Gateway's `provider.auto` routing will use the fast model for tool calls and the larger model for reasoning.

### Multi-GPU Configuration (Optional)

If a second GPU is available (e.g., RTX 3060 Ti 12GB or Tesla P40 24GB):

```yaml
# .pixelclaw.yaml (multi-gpu override)
provider:
  lmstudio:
    base_url: "http://localhost:1234/v1"         # inference GPU (3090 Ti)
    embed_url: "http://localhost:1235/v1"        # embedding GPU (3060 Ti)
    model: "llama-3.3-70b-instruct"
    embed_model: "nomic-embed-text"
```

Run two LM Studio instances on different ports. The Gateway's `EmbedderClient` reads `embed_url` separately from `base_url`.

---

## 13. Repo Structure

```
pixelclaw/
├── gateway/                          # Python FastAPI service
│   ├── main.py                       # App entrypoint
│   ├── config.py                     # Config loader (.pixelclaw.yaml parser)
│   ├── jsonl_emitter.py              # Animation event emitter
│   ├── providers/
│   │   ├── __init__.py
│   │   ├── router.py                 # ProviderRouter class
│   │   ├── lmstudio.py               # LM Studio provider
│   │   ├── claude.py                 # Anthropic provider
│   │   └── base.py                   # BaseProvider protocol
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── registry.py               # Tool registration + OpenAI/Anthropic schema translation
│   │   ├── zeroclaw_tool.py          # ZeroClaw subprocess wrapper
│   │   └── mcp_host.py               # MCP server process manager
│   ├── memory/
│   │   ├── __init__.py
│   │   ├── store.py                  # SQLite-vec read/write/retrieve
│   │   └── embedder.py               # Embedding client (LM Studio /embeddings)
│   ├── tasks/
│   │   ├── __init__.py
│   │   └── queue.py                  # SQLite task log
│   └── requirements.txt
│
├── extension/                        # VS Code extension (PixelAgents fork)
│   ├── src/
│   │   ├── extension.ts              # Extension entrypoint
│   │   ├── gateway-client.ts         # WebSocket client for Gateway
│   │   ├── workspace-detector.ts     # .pixelclaw.yaml detection
│   │   └── status-bar.ts             # Gateway/provider status bar item
│   ├── webview-ui/                   # PixelAgents React UI (existing)
│   └── package.json
│
├── zeroclaw/                         # ZeroClaw binary + config templates
│   ├── config.toml.tmpl              # Template for per-project config injection
│   └── README.md                     # ZeroClaw setup notes
│
├── mcp-servers/
│   └── servers.json                  # Registry of available MCP servers
│
├── tests/
│   ├── smoke/
│   │   ├── test_gateway_boot.py
│   │   ├── test_lmstudio_ping.py
│   │   └── test_zeroclaw_version.py
│   ├── integration/
│   │   ├── test_full_roundtrip.py    # prompt → provider → tool → JSONL emitted
│   │   ├── test_memory_store.py
│   │   └── test_provider_switch.py
│   └── fixtures/
│       ├── sample_project_a/         # Realistic project fixture
│       │   ├── .pixelclaw.yaml
│       │   └── src/
│       └── sample_project_b/
│
├── scripts/
│   ├── doctor.ps1                    # Prerequisites checker
│   ├── run-dev.ps1                   # Start Gateway + Extension dev mode
│   ├── test.ps1                      # Run full test suite
│   ├── format.ps1                    # ruff format + black + prettier
│   ├── lint.ps1                      # ruff + mypy + eslint (fail on warnings)
│   ├── build.ps1                     # Production build
│   └── release.ps1                   # Local packaging
│
├── docker/
│   ├── compose.yaml                  # Gateway + optional services
│   └── gateway.Dockerfile
│
├── data/                             # Runtime data (gitignored)
│   ├── memory.db
│   ├── tasks.db
│   └── events/
│
├── docs/
│   ├── setup.md
│   ├── providers.md
│   └── per-project-config.md
│
├── .github/
│   └── workflows/
│       ├── ci.yaml
│       └── release.yaml
│
├── env/
│   └── .env.example
│
├── README.md
├── ARCHITECTURE.md                   # This document
├── CHANGELOG.md
└── SECURITY.md
```

---

## 14. Environment Variables

```bash
# env/.env.example — copy to .env, never commit .env

# ── REQUIRED (LM Studio default) ──────────────────────────────────────────
LM_STUDIO_URL=http://localhost:1234/v1
# LM_STUDIO_EMBED_URL=http://localhost:1235/v1   # optional: second GPU for embeddings

# ── OPTIONAL: Claude provider ─────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-your-key-here

# ── OPTIONAL: OpenAI-compatible fallback ──────────────────────────────────
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# ── GATEWAY SETTINGS ──────────────────────────────────────────────────────
GATEWAY_PORT=7892
GATEWAY_HOST=0.0.0.0
GATEWAY_LOG_LEVEL=INFO             # DEBUG | INFO | WARNING | ERROR
GATEWAY_TASK_TIMEOUT=120           # ZeroClaw subprocess timeout in seconds

# ── DATA PATHS ────────────────────────────────────────────────────────────
DATA_DIR=./data
EVENTS_DIR=./data/events
MEMORY_DB=./data/memory.db
TASKS_DB=./data/tasks.db

# ── SECURITY ──────────────────────────────────────────────────────────────
GATEWAY_API_KEY=                   # optional: require Bearer token for API access
CORS_ORIGINS=vscode-webview://     # restrict CORS to VS Code webviews only
```

---

## 15. CI/CD Pipeline

### `.github/workflows/ci.yaml`

```yaml
name: PixelClaw CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  gateway:
    name: Gateway (Python)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - name: Install dependencies
        run: pip install -r gateway/requirements.txt
      - name: Format check (ruff + black)
        run: |
          ruff format --check gateway/
          black --check gateway/
      - name: Lint (ruff — warnings = fail)
        run: ruff check --select ALL gateway/
      - name: Type check (mypy strict)
        run: mypy gateway/ --strict
      - name: Security (bandit + pip-audit)
        run: |
          bandit -r gateway/ -ll
          pip-audit -r gateway/requirements.txt
      - name: Smoke tests
        run: pytest tests/smoke/ -v
      - name: Integration tests
        run: pytest tests/integration/ -v
        env:
          LM_STUDIO_URL: ${{ secrets.LM_STUDIO_URL_CI }}

  extension:
    name: Extension (TypeScript)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: cd webview-ui && npm ci
      - run: npm run lint         # eslint — 0 warnings
      - run: npm run typecheck    # tsc --noEmit strict
      - run: npm run build

  security:
    name: Secret + Dependency Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
      - run: npm audit --audit-level=high

  build:
    name: Release Build
    needs: [gateway, extension, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Build VSIX
        run: npm run package
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: pixelclaw-${{ github.sha }}.vsix
          path: "*.vsix"
```

---

## 16. Key Decisions & Trade-offs

### Why FastAPI over Node.js for the Gateway?

The memory layer (SQLite-vec), embedding client, and ZeroClaw subprocess management are easier to implement correctly in Python. The `asyncio` subprocess API, `anthropic` Python SDK, and `sqlite-vec` Python bindings are all first-class. The VS Code extension remains TypeScript; the Gateway is the one place where Python's ML ecosystem matters.

### Why SQLite-vec over Chroma / Qdrant / Weaviate?

SQLite-vec requires zero additional services. It runs in-process as a SQLite extension. For a single-developer local tool, this eliminates a major source of operational complexity. Migration to Chroma or Qdrant is straightforward if scale demands it — the `MemoryStore` class behind a `BaseMemoryStore` protocol makes this a one-file swap.

### Why subprocess for ZeroClaw (not FFI or HTTP)?

ZeroClaw is a Rust binary. The cleanest integration is subprocess — it preserves ZeroClaw's standalone operability, requires no Rust-Python FFI (which introduces complex build dependencies), and maps naturally to the tool execution model. The structured JSON stdout mode makes it machine-friendly without changing ZeroClaw's architecture.

### Why LM Studio over Ollama as the default?

LM Studio provides a richer model management UI and is better suited for the target user (vibe coder, not CLI-native). Both expose OpenAI-compatible APIs. Switching to Ollama is a one-line `base_url` change.

### Why not build on top of an existing agent framework (LangChain, LlamaIndex)?

PixelClaw's core value is the visual/animation layer and the ZeroClaw integration. Layering LangChain introduces significant complexity and abstraction mismatch. The provider abstraction built here is small (~200 lines), fully auditable, and directly maps to what LM Studio and Claude actually need.

---

## 17. Glossary

| Term | Definition |
|---|---|
| **Gateway** | The PixelClaw FastAPI bridge service running on port 7892 |
| **ZeroClaw** | Rust-native agentic task executor — the "hands" of the agent |
| **PixelAgents** | The VS Code extension providing the animated character "living office" UI |
| **Provider** | An LLM backend: LM Studio, Claude API, or OpenAI-compatible endpoint |
| **Provider Router** | Gateway module that abstracts all providers behind a unified async interface |
| **MCP** | Model Context Protocol — standard for giving LLMs access to external tools |
| **SQLite-vec** | SQLite extension adding vector similarity search for the memory layer |
| **nomic-embed-text** | Local embedding model (768-dim) used for memory retrieval |
| **JSONL Emitter** | Gateway module that writes animation events to the PixelAgents watch folder |
| **Namespace** | Per-project isolation key for memory entries — set in `.pixelclaw.yaml` |
| **`.pixelclaw.yaml`** | Per-workspace configuration file; loaded by Gateway on workspace open |
| **`auto` provider** | Routing mode where Gateway selects provider based on task type and availability |
| **Claude Desktop** | Anthropic's desktop app; can consume PixelClaw tools via the Gateway MCP endpoint |
| **Claude Code** | VS Code extension for AI-assisted coding; bridged from PixelAgent chat in Phase 3 |
