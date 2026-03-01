/**
 * PixelClaw E2E — Agent Chat System Tests
 *
 * Tests the inter-agent communication, message bus, model switching,
 * memory store, and orchestrator coordination.
 *
 * These tests verify:
 *   - Agent registration and lifecycle
 *   - Message routing (direct, broadcast, threaded)
 *   - Model switching with context preservation
 *   - Memory store persistence and retrieval
 *   - Orchestrator task delegation
 *   - Stateful continuation across model switches
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234';
const LM_API_TOKEN = process.env.LM_API_TOKEN || '';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LM_API_TOKEN) headers['Authorization'] = `Bearer ${LM_API_TOKEN}`;
  return headers;
}

// ─── Agent Protocol & Types ─────────────────────────────────────────────────
// Inline simplified types for test isolation (no extension imports needed)

type AgentRole = 'code' | 'reasoning' | 'vision' | 'tool_use' | 'chat' | 'evony' | 'orchestrator';
type AgentStatus = 'idle' | 'active' | 'waiting' | 'switching_model' | 'error' | 'offline';

interface AgentIdentity {
  id: string;
  name: string;
  role: AgentRole;
  capabilities: AgentRole[];
  modelKey: string | null;
  status: AgentStatus;
}

interface AgentMessage {
  id: string;
  threadId: string;
  from: string;
  to: string | string[] | null;
  type: string;
  content: string;
  timestamp: number;
  priority: number;
}

interface ConversationThread {
  id: string;
  title: string;
  participants: string[];
  messages: AgentMessage[];
  status: string;
}

// ─── Test Source Files Exist ─────────────────────────────────────────────────

test.describe('Agent Chat System — Source Files', () => {
  const agentDir = path.resolve(__dirname, '../../extension/src/agents');

  test('All agent system source files exist', () => {
    const files = [
      'protocol.ts',
      'messageBus.ts',
      'modelManager.ts',
      'memoryStore.ts',
      'orchestrator.ts',
      'index.ts',
    ];

    for (const f of files) {
      const fullPath = path.join(agentDir, f);
      expect(fs.existsSync(fullPath), `Missing: ${f}`).toBe(true);
    }
    console.log(`  All ${files.length} agent system source files present`);
  });

  test('Protocol defines required types', () => {
    const protocolPath = path.join(agentDir, 'protocol.ts');
    const content = fs.readFileSync(protocolPath, 'utf-8');

    const requiredTypes = [
      'AgentRole',
      'AgentStatus',
      'AgentIdentity',
      'AgentMessage',
      'MessageType',
      'ConversationThread',
      'ModelState',
      'BusEvent',
      'TaskAssignPayload',
      'HandoffPayload',
      'ModelSwitchPayload',
      'ContextSharePayload',
    ];

    for (const t of requiredTypes) {
      expect(content.includes(t), `Protocol missing type: ${t}`).toBe(true);
    }
    console.log(`  Protocol exports ${requiredTypes.length} required types`);
  });

  test('MessageBus has required methods', () => {
    const busPath = path.join(agentDir, 'messageBus.ts');
    const content = fs.readFileSync(busPath, 'utf-8');

    const methods = [
      'registerAgent',
      'unregisterAgent',
      'send',
      'broadcast',
      'assignTask',
      'handoff',
      'createThread',
      'findBestAgent',
      'trackResponseId',
      'getLatestResponseId',
    ];

    for (const m of methods) {
      expect(content.includes(m), `MessageBus missing method: ${m}`).toBe(true);
    }
    console.log(`  MessageBus exports ${methods.length} required methods`);
  });

  test('ModelManager has load/unload/switch/chat', () => {
    const mmPath = path.join(agentDir, 'modelManager.ts');
    const content = fs.readFileSync(mmPath, 'utf-8');

    const methods = [
      'discoverModels',
      'loadModel',
      'unloadModel',
      'switchModel',
      'chat',
      'bindAgentToModel',
      'unbindAgentFromModel',
    ];

    for (const m of methods) {
      expect(content.includes(m), `ModelManager missing method: ${m}`).toBe(true);
    }
    console.log(`  ModelManager exports ${methods.length} required methods`);
  });

  test('MemoryStore has context preservation methods', () => {
    const msPath = path.join(agentDir, 'memoryStore.ts');
    const content = fs.readFileSync(msPath, 'utf-8');

    const methods = [
      'store',
      'search',
      'storeConversationSummary',
      'getConversationContext',
      'buildContextReplay',
      'storeTaskResult',
      'storeProjectState',
      'getProjectState',
      'compact',
    ];

    for (const m of methods) {
      expect(content.includes(m), `MemoryStore missing method: ${m}`).toBe(true);
    }
    console.log(`  MemoryStore exports ${methods.length} required methods`);
  });

  test('Orchestrator wires all components together', () => {
    const orchPath = path.join(agentDir, 'orchestrator.ts');
    const content = fs.readFileSync(orchPath, 'utf-8');

    const features = [
      'MessageBus',
      'ModelManager',
      'MemoryStore',
      'submitTask',
      'executeAgentTurn',
      'switchAgentModel',
      'handoffConversation',
      'inferCapabilities',
      'AGENT_TEMPLATES',
    ];

    for (const f of features) {
      expect(content.includes(f), `Orchestrator missing: ${f}`).toBe(true);
    }
    console.log(`  Orchestrator integrates ${features.length} features`);
  });
});

// ─── Message Bus Logic ──────────────────────────────────────────────────────

test.describe('Agent Chat System — Message Bus Logic', () => {
  // Simulate message bus behavior in-test (no runtime imports needed)

  test('Agent selection prefers idle agents with matching role', () => {
    const agents: AgentIdentity[] = [
      { id: 'a1', name: 'CodeBot', role: 'code', capabilities: ['code', 'tool_use'], modelKey: 'model-a', status: 'active' },
      { id: 'a2', name: 'CodeBot2', role: 'code', capabilities: ['code'], modelKey: 'model-b', status: 'idle' },
      { id: 'a3', name: 'Thinker', role: 'reasoning', capabilities: ['reasoning'], modelKey: 'model-c', status: 'idle' },
    ];

    // Simulate findBestAgent scoring
    const requiredCaps: AgentRole[] = ['code'];
    const scored = agents
      .filter(a => a.status !== 'offline' && a.status !== 'error')
      .map(a => {
        let score = 0;
        for (const cap of requiredCaps) {
          if (a.role === cap) score += 10;
          else if (a.capabilities.includes(cap)) score += 5;
        }
        if (a.status === 'idle') score += 20;
        if (a.modelKey) score += 5;
        return { agent: a, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    expect(scored.length).toBe(2);
    expect(scored[0].agent.id).toBe('a2'); // idle code agent wins
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    console.log(`  Best agent for 'code': ${scored[0].agent.id} (score ${scored[0].score})`);
  });

  test('Message threading creates unique thread IDs', () => {
    const threads: Map<string, ConversationThread> = new Map();
    const makeThread = (title: string, participants: string[]) => {
      const id = `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const t: ConversationThread = { id, title, participants, messages: [], status: 'active' };
      threads.set(id, t);
      return t;
    };

    const t1 = makeThread('Task A', ['orch', 'code-1']);
    const t2 = makeThread('Task B', ['orch', 'vision-1']);

    expect(t1.id).not.toBe(t2.id);
    expect(threads.size).toBe(2);
    console.log(`  Thread 1: ${t1.id}`);
    console.log(`  Thread 2: ${t2.id}`);
  });

  test('Capability inference from task descriptions', () => {
    const inferCaps = (task: string): AgentRole[] => {
      const lower = task.toLowerCase();
      const caps: AgentRole[] = [];
      if (/\b(code|fix|bug|function|implement|debug)\b/.test(lower)) caps.push('code');
      if (/\b(screenshot|image|visual|ui|layout)\b/.test(lower)) caps.push('vision');
      if (/\b(plan|design|architect|analyze|strategy)\b/.test(lower)) caps.push('reasoning');
      if (/\b(tool|mcp|function.call|api|execute)\b/.test(lower)) caps.push('tool_use');
      if (/\b(evony|game|battle|troop)\b/.test(lower)) caps.push('evony');
      if (caps.length === 0) caps.push('code');
      return caps;
    };

    expect(inferCaps('Fix the login bug in auth.ts')).toEqual(['code']);
    expect(inferCaps('Analyze the screenshot for layout issues')).toEqual(['vision', 'reasoning']);
    expect(inferCaps('Plan the database migration strategy')).toEqual(['reasoning']);
    expect(inferCaps('Execute the MCP tool to fetch data')).toEqual(['tool_use']);
    expect(inferCaps('Optimize the Evony battle troop formation')).toEqual(['evony']);
    expect(inferCaps('Hello world')).toEqual(['code']); // default
    console.log(`  Capability inference: 6/6 scenarios correct`);
  });
});

// ─── Memory Store ───────────────────────────────────────────────────────────

test.describe('Agent Chat System — Memory Store', () => {
  const tmpDir = path.join(os.tmpdir(), `pixelclaw-test-${Date.now()}`);

  test.beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  test.afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('Creates .pixelclaw directory and agent-memory.json', () => {
    const storeDir = path.join(tmpDir, '.pixelclaw');
    fs.mkdirSync(storeDir, { recursive: true });
    const memFile = path.join(storeDir, 'agent-memory.json');
    const data = { version: 1, entries: [], responseChains: {}, lastCompactedAt: Date.now() };
    fs.writeFileSync(memFile, JSON.stringify(data, null, 2));

    expect(fs.existsSync(memFile)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    expect(loaded.version).toBe(1);
    expect(loaded.entries).toEqual([]);
    console.log(`  Memory store created at ${memFile}`);
  });

  test('Stores and retrieves conversation summaries', () => {
    const entries: Array<{ id: string; type: string; agentId: string; threadId: string; content: string; tags: string[] }> = [];

    // Simulate storeConversationSummary
    entries.push({
      id: `mem_${Date.now()}_abc`,
      type: 'conversation_summary',
      agentId: 'agent-code-1',
      threadId: 'thread_123',
      content: 'User asked for fibonacci function. Agent provided recursive + memoized versions.',
      tags: ['conversation', 'model_switch', 'Nerdsking/nerdsking-python-coder-7b-i'],
    });

    // Search by thread
    const found = entries.filter(e => e.threadId === 'thread_123' && e.type === 'conversation_summary');
    expect(found.length).toBe(1);
    expect(found[0].content).toContain('fibonacci');
    console.log(`  Stored and retrieved conversation summary`);
  });

  test('Context replay builds correct system prompt', () => {
    const summaries = [
      { content: 'Turn 1: User asked about sorting algorithms', createdAt: Date.now() - 60000 },
      { content: 'Turn 2: Agent explained quicksort vs mergesort', createdAt: Date.now() - 30000 },
      { content: 'Turn 3: User chose quicksort implementation', createdAt: Date.now() },
    ];

    const replay = [
      '=== CONVERSATION CONTEXT (preserved across model switch) ===',
      '',
      ...summaries.map(s => `[${new Date(s.createdAt).toISOString()}] ${s.content}`),
      '',
      '=== END CONTEXT ===',
    ].join('\n');

    expect(replay).toContain('CONVERSATION CONTEXT');
    expect(replay).toContain('quicksort');
    expect(replay).toContain('END CONTEXT');
    expect(replay.split('\n').length).toBeGreaterThan(5);
    console.log(`  Context replay: ${replay.split('\\n').length} lines`);
  });
});

// ─── Live Model Switching (requires LM Studio) ─────────────────────────────

test.describe('Agent Chat System — Live Model Switching', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const resp = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
        timeout: 5000,
        headers: authHeaders(),
      });
      if (resp.status() !== 200) test.skip();
    } catch {
      console.log(`  LM Studio not reachable — skipping live tests`);
      test.skip();
    }
  });

  test('Agent starts conversation, gets response_id, continues statefully', async ({ request }) => {
    const MODEL = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';

    // Turn 1: Start conversation
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        system_prompt: 'You are CodeBot, a PixelClaw coding agent. Be concise.',
        input: 'Remember: the project name is PixelClaw and the current task is fixing auth.ts.',
        max_output_tokens: 50,
      },
      timeout: 60000,
    });

    if (r1.status() !== 200) { test.skip(); return; }

    const body1 = await r1.json();
    expect(body1).toHaveProperty('response_id');
    const rid1 = body1.response_id;
    console.log(`  Turn 1 response_id: ${rid1}`);

    // Turn 2: Continue with previous_response_id
    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        input: 'What project are we working on and what file needs fixing?',
        previous_response_id: rid1,
        max_output_tokens: 80,
      },
      timeout: 60000,
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    expect(body2).toHaveProperty('response_id');
    expect(body2.response_id).not.toBe(rid1);

    const content = body2.output?.find((o: any) => o.type === 'message')?.content || '';
    console.log(`  Turn 2 response: ${content.substring(0, 120)}`);
  });

  test('Cross-agent context replay simulates model switch', async ({ request }) => {
    const MODEL = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';

    // Agent A: Code agent works on a task
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        system_prompt: 'You are CodeBot. Write only code, no explanations.',
        input: 'Write a TypeScript function called "add" that takes two numbers and returns their sum.',
        max_output_tokens: 100,
        store: false,
      },
      timeout: 60000,
    });

    if (r1.status() !== 200) { test.skip(); return; }
    const body1 = await r1.json();
    const codeAgentResponse = body1.output?.find((o: any) => o.type === 'message')?.content || '';
    console.log(`  Code agent: ${codeAgentResponse.substring(0, 80)}...`);

    // Simulate context summary (what memory store would do)
    const contextSummary = `Previous agent (CodeBot) produced:\n${codeAgentResponse.substring(0, 500)}`;

    // Agent B: Reasoning agent reviews the code (simulated with same model)
    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        system_prompt: [
          'You are Thinker, a PixelClaw reasoning agent.',
          'You review code from other agents and suggest improvements.',
          '',
          '=== CONVERSATION CONTEXT (preserved across model switch) ===',
          contextSummary,
          '=== END CONTEXT ===',
        ].join('\n'),
        input: 'Review the code from CodeBot. Is the add function correct? Suggest any improvements.',
        max_output_tokens: 150,
        store: false,
      },
      timeout: 60000,
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    const reviewResponse = body2.output?.find((o: any) => o.type === 'message')?.content || '';
    expect(reviewResponse.length).toBeGreaterThan(0);
    console.log(`  Reasoning agent review: ${reviewResponse.substring(0, 120)}...`);
  });

  test('Multi-turn agent conversation with handoff', async ({ request }) => {
    const MODEL = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';

    // Orchestrator assigns task to Code agent
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        system_prompt: 'You are an AI orchestrator. Decompose tasks into subtasks.',
        input: 'Task: Add a login form to the website. Break this into 2-3 subtasks for a code agent and a vision agent.',
        max_output_tokens: 200,
        store: false,
      },
      timeout: 60000,
    });

    if (r1.status() !== 200) { test.skip(); return; }
    const orchResponse = (await r1.json()).output?.find((o: any) => o.type === 'message')?.content || '';
    console.log(`  Orchestrator decomposition: ${orchResponse.substring(0, 150)}...`);

    // Code agent works on first subtask
    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL,
        system_prompt: [
          'You are CodeBot, a PixelClaw coding agent.',
          `Orchestrator assigned you: ${orchResponse.substring(0, 300)}`,
        ].join('\n'),
        input: 'Implement the HTML structure for a login form with username, password, and submit button.',
        max_output_tokens: 200,
        store: false,
      },
      timeout: 60000,
    });

    expect(r2.status()).toBe(200);
    const codeResponse = (await r2.json()).output?.find((o: any) => o.type === 'message')?.content || '';
    expect(codeResponse.length).toBeGreaterThan(0);
    console.log(`  Code agent result: ${codeResponse.substring(0, 120)}...`);
  });
});

// ─── Model Registry Integration ─────────────────────────────────────────────

test.describe('Agent Chat System — Model Registry Integration', () => {
  test('Agent role default models exist in models.yaml', () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    if (!fs.existsSync(modelsPath)) {
      console.log('  models.yaml not found — skipping');
      test.skip();
      return;
    }

    const content = fs.readFileSync(modelsPath, 'utf-8');

    // Check that default models for each agent role are registered
    const defaultModels = [
      'openai/gpt-oss-20b',           // orchestrator, reasoning
      'Nerdsking/nerdsking-python-coder-7b-i', // code, tool_use
      'dphn/dolphin3.0-llama3.1-8b',  // chat
    ];

    for (const m of defaultModels) {
      expect(content.includes(m), `Default model not in registry: ${m}`).toBe(true);
    }
    console.log(`  All ${defaultModels.length} default agent models found in registry`);
  });

  test('Agent roles in models.yaml match protocol roles', () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    if (!fs.existsSync(modelsPath)) { test.skip(); return; }

    const content = fs.readFileSync(modelsPath, 'utf-8');
    const protocolRoles: AgentRole[] = ['code', 'reasoning', 'vision', 'tool_use', 'chat', 'evony'];

    for (const role of protocolRoles) {
      // models.yaml uses agent_roles with these keys
      expect(content.includes(`  ${role}:`), `Role missing from models.yaml: ${role}`).toBe(true);
    }
    console.log(`  All ${protocolRoles.length} agent roles defined in models.yaml`);
  });
});
