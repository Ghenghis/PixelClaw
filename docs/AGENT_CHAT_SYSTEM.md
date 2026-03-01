# PixelClaw Agent Chat System — Architecture

> Inter-agent communication with dynamic model switching and seamless context preservation.

## Overview

The Agent Chat System enables PixelClaw agents to communicate with each other, delegate tasks, switch models dynamically, and maintain conversation context across model transitions. This is built on top of LM Studio's native REST API.

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentOrchestrator                         │
│           (Task decomposition, delegation, routing)          │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  MessageBus  │ ModelManager │ MemoryStore  │ Agent Registry │
│  • send()    │ • load()     │ • store()    │ • code         │
│  • broadcast │ • unload()   │ • search()   │ • reasoning    │
│  • handoff() │ • switch()   │ • replay()   │ • vision       │
│  • thread()  │ • chat()     │ • compact()  │ • tool_use     │
│  • route()   │ • discover() │ • project()  │ • chat         │
└──────┬───────┴──────┬───────┴──────┬───────┴────────────────┘
       │              │              │
       ▼              ▼              ▼
  Event Handlers  LM Studio API  .pixelclaw/agent-memory.json
                  /api/v1/*      (persistent storage)
```

## Source Files

| File | Purpose |
|------|---------|
| `extension/src/agents/protocol.ts` | Message types, agent identity, threading primitives |
| `extension/src/agents/messageBus.ts` | Message routing, thread management, agent selection |
| `extension/src/agents/modelManager.ts` | LM Studio load/unload/switch, VRAM management |
| `extension/src/agents/memoryStore.ts` | Persistent shared knowledge, context replay |
| `extension/src/agents/orchestrator.ts` | Top-level coordinator wiring all components |
| `extension/src/agents/index.ts` | Barrel exports |
| `tests/e2e/agent.chat.ts` | E2E test suite |
| `tests/e2e/lmstudio.models.ts` | Model management tests |

## Agent Roles

| Role | Name | Default Model | Capabilities |
|------|------|---------------|-------------|
| `orchestrator` | Orchestrator | `openai/gpt-oss-20b` | reasoning, chat |
| `code` | CodeBot | `nerdsking-python-coder-7b-i` | code, tool_use |
| `reasoning` | Thinker | `openai/gpt-oss-20b` | reasoning, chat |
| `vision` | EyeBot | `qwen3-vl-4b` | vision |
| `tool_use` | ToolBot | `nerdsking-python-coder-7b-i` | tool_use, code |
| `chat` | ChatBot | `dolphin3.0-llama3.1-8b` | chat |
| `evony` | EvonyBot | `evony-qwen3-8b-phase2` | evony, chat |

## Core Concepts

### 1. Message Bus

The `MessageBus` is an in-process event bus that routes messages between agents. It supports:

- **Direct messages** — Agent A sends to Agent B
- **Broadcast** — Agent sends to all agents
- **Multi-target** — Agent sends to multiple specific agents
- **Threaded conversations** — Messages are grouped into threads
- **Priority queue** — Higher priority messages are delivered first

```typescript
// Send a direct message
bus.send({
  from: 'agent-code-1',
  to: 'agent-reasoning-1',
  type: 'chat',
  content: 'I found a bug in auth.ts — can you analyze the root cause?',
});

// Assign a task (auto-selects best agent)
bus.assignTask({
  from: 'agent-orchestrator',
  task: 'Implement login form validation',
  requiredCapabilities: ['code'],
});
```

### 2. Model Manager

The `ModelManager` handles dynamic model loading/unloading via LM Studio's REST API:

```
GET  /api/v1/models         → List all models (loaded + available)
POST /api/v1/models/load    → Load model into VRAM
POST /api/v1/models/unload  → Unload model from VRAM
POST /api/v1/chat           → Stateful chat with response_id
```

**Key features:**
- **Parallel limit** — Max 2 models loaded simultaneously (configurable)
- **Auto-unload** — Idle models unloaded after 30 minutes
- **VRAM-aware** — Evicts least-used models when limit reached
- **Agent binding** — Tracks which agents use which models

### 3. Memory Store

The `MemoryStore` persists shared knowledge to `.pixelclaw/agent-memory.json`:

- **Conversation summaries** — Stored before model switches
- **Project state** — Key-value pairs all agents can read
- **Task results** — Outcomes of completed tasks
- **Agent knowledge** — Insights and decisions
- **TTL support** — Entries can auto-expire

### 4. Context Preservation

When an agent switches models, context is preserved through two mechanisms:

#### Same-Model Continuation (Stateful)
LM Studio's native API supports `response_id` chains. Each response returns a `response_id` that can be passed as `previous_response_id` in the next request:

```
Turn 1 → response_id: "abc123"
Turn 2 → previous_response_id: "abc123" → response_id: "def456"
Turn 3 → previous_response_id: "def456" → ...
```

#### Cross-Model Continuation (Memory Replay)
When switching to a different model, the system:

1. Generates a conversation summary from recent messages
2. Stores summary + response chain in `MemoryStore`
3. Unloads old model, loads new model
4. Injects summary as `system_prompt` for the new model

```
Agent on Model A:
  "Write a fibonacci function" → [code output]
  "Add memoization" → [improved code]
  
  ── MODEL SWITCH ──
  Summary stored: "Agent wrote fibonacci with memoization..."
  
Agent on Model B:
  system_prompt: "CONVERSATION CONTEXT: Agent wrote fibonacci..."
  "Now add unit tests" → [tests referencing the fibonacci code]
```

### 5. Agent Handoff

When one agent can't complete a task, it hands off to another agent:

1. Source agent stores conversation context in `MemoryStore`
2. `MessageBus.handoff()` sends a handoff message with summary
3. Target agent joins the thread
4. Target agent gets context replay via `system_prompt`

```typescript
await orchestrator.handoffConversation({
  fromAgentId: 'agent-code-1',
  toAgentId: 'agent-vision-1',
  threadId: 'thread_abc',
  reason: 'Need visual analysis of the rendered UI',
});
```

## Task Flow

```
User: "Fix the login bug and verify the UI looks correct"
  │
  ▼
Orchestrator (infers: code + vision)
  │
  ├─ Creates thread "Task: Fix the login bug..."
  │
  ├─ Assigns to CodeBot: "Fix the login bug in auth.ts"
  │   │
  │   ├─ CodeBot loads nerdsking-python-coder-7b
  │   ├─ CodeBot fixes the bug
  │   ├─ CodeBot sends task_result to thread
  │   └─ CodeBot requests handoff to EyeBot
  │
  └─ Handoff to EyeBot: "Verify UI looks correct"
      │
      ├─ EyeBot loads qwen3-vl-4b
      ├─ EyeBot gets context: "CodeBot fixed auth.ts..."
      ├─ EyeBot analyzes screenshots
      └─ EyeBot sends task_result: "UI verified ✓"
```

## Configuration

### .pixelclaw.yaml

```yaml
agent_chat:
  lm_studio_url: http://100.117.198.97:1234
  api_token: ${LM_API_TOKEN}
  parallel_models_max: 2
  auto_unload_idle_minutes: 30
  default_context_length: 8192
  prefer_flash_attention: true
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LM_STUDIO_URL` | LM Studio API base URL | `http://100.117.198.97:1234` |
| `LM_API_TOKEN` | API authentication token | (empty) |
| `LM_STUDIO_MODEL` | Default model for tests | `nerdstking-python-coder-7b-i` |
| `LM_TEST_SMALL_MODEL` | Small model for load/unload tests | `Nerdsking/nerdsking-python-coder-3b-i` |

## E2E Test Coverage

| Suite | Tests | Type |
|-------|-------|------|
| Source files exist | 6 | Static |
| Protocol types | 12+ types verified | Static |
| MessageBus methods | 10 methods verified | Static |
| ModelManager methods | 7 methods verified | Static |
| MemoryStore methods | 9 methods verified | Static |
| Orchestrator integration | 9 features verified | Static |
| Agent selection scoring | Priority + idle logic | Logic |
| Thread management | Unique IDs + participants | Logic |
| Capability inference | 6 task → role scenarios | Logic |
| Memory store persistence | Create, write, read | I/O |
| Context replay | Summary → system_prompt | Logic |
| Live stateful chat | response_id continuation | API |
| Cross-agent context | Model switch simulation | API |
| Multi-turn handoff | Orchestrator → agents | API |
| Model registry integration | models.yaml validation | Static |

## Model Switching Strategy

### When to Switch
- **Task requires different capability** (e.g., code → vision)
- **Current model lacks capacity** (e.g., small model → large model for complex reasoning)
- **Agent specialization** (e.g., general chat → evony-specific model)

### VRAM Management
1. Max 2 models loaded at once (configurable)
2. When loading a 3rd model, evict least-used idle model
3. Models with active agents are never auto-evicted
4. Idle models are auto-unloaded after 30 minutes

### Response Chain Handling
- Same model: Use `previous_response_id` for stateful continuation
- Different model: Clear response chain, replay context via `system_prompt`
- Branching: Fork from any `response_id` in the chain

## Future Enhancements

1. **Streaming support** — Stream agent responses in real-time
2. **MCP tool sharing** — Agents can invoke MCP tools and share results
3. **Anthropic API support** — Use `/v1/messages` alongside OpenAI-compat
4. **Agent spawning** — Dynamically create/destroy agents based on load
5. **Conversation branching UI** — Visualize thread forks in the webview
6. **Model recommendations** — Auto-suggest better models based on task performance
7. **Multi-directory model discovery** — Scan LM Studio, Ollama, and HuggingFace cache
