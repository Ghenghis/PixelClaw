/**
 * PixelClaw E2E — LM Studio Model Management Tests
 *
 * Tests dynamic model load/unload, discovery, switching, and stateful
 * continuation across model transitions.
 *
 * API Endpoints tested:
 *   GET  /api/v1/models              — List all models (loaded + available)
 *   POST /api/v1/models/load         — Load a model into memory
 *   POST /api/v1/models/unload       — Unload a model from memory
 *   POST /api/v1/chat                — Chat with stateful continuation
 *
 * Docs: https://lmstudio.ai/docs/developer/rest
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234';
const LM_API_TOKEN = process.env.LM_API_TOKEN || '';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LM_API_TOKEN) {
    headers['Authorization'] = `Bearer ${LM_API_TOKEN}`;
  }
  return headers;
}

// Pre-flight check
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      timeout: 5000,
      headers: authHeaders(),
    });
    if (response.status() !== 200) {
      console.log(`  LM Studio returned ${response.status()} — skipping model mgmt tests`);
      test.skip();
    }
  } catch {
    console.log(`  LM Studio not reachable at ${LM_STUDIO_URL} — skipping model mgmt tests`);
    test.skip();
  }
});

// ─── Model Registry Validation ──────────────────────────────────────────────

test.describe('Model Registry — models.yaml', () => {
  test('models.yaml exists and is valid YAML', async () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    expect(fs.existsSync(modelsPath)).toBe(true);

    const content = fs.readFileSync(modelsPath, 'utf-8');
    const config = yaml.parse(content);
    expect(config).toHaveProperty('models');
    expect(config).toHaveProperty('agent_roles');
    expect(config).toHaveProperty('vram_tiers');
    expect(config).toHaveProperty('model_directories');
    expect(config).toHaveProperty('switching');
    console.log(`  Registry: ${config.models.length} models, ${Object.keys(config.agent_roles).length} agent roles`);
  });

  test('All agent roles reference valid model IDs', async () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    const config = yaml.parse(fs.readFileSync(modelsPath, 'utf-8'));
    const modelIds = new Set(config.models.map((m: any) => m.id));

    for (const [role, roleConfig] of Object.entries(config.agent_roles as Record<string, any>)) {
      for (const [tier, models] of Object.entries(roleConfig.models as Record<string, string[]>)) {
        for (const modelId of models) {
          expect(modelIds.has(modelId), `${role}/${tier}: ${modelId} not in models list`).toBe(true);
        }
      }
    }
    console.log(`  All agent role model references are valid`);
  });

  test('Every model has required fields', async () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    const config = yaml.parse(fs.readFileSync(modelsPath, 'utf-8'));

    for (const model of config.models) {
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('arch');
      expect(model).toHaveProperty('params');
      expect(model).toHaveProperty('size_gb');
      expect(model).toHaveProperty('capabilities');
      expect(model).toHaveProperty('tier');
      expect(Array.isArray(model.capabilities)).toBe(true);
    }
    console.log(`  All ${config.models.length} models have required fields`);
  });

  test('Model directories are configured', async () => {
    const modelsPath = path.resolve(__dirname, '../../models.yaml');
    const config = yaml.parse(fs.readFileSync(modelsPath, 'utf-8'));

    expect(config.model_directories.length).toBeGreaterThan(0);
    // Check primary directory exists
    const primaryDir = config.model_directories[0];
    const exists = fs.existsSync(primaryDir);
    console.log(`  Primary: ${primaryDir} — ${exists ? 'EXISTS' : 'NOT FOUND (expected on CI)'}`);
  });
});

// ─── Model Discovery ────────────────────────────────────────────────────────

test.describe('Model Discovery — /api/v1/models', () => {
  test('Lists all available models with full metadata', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Native API returns { models: [...] } not { data: [...] }
    const models = body.models || body.data || [];
    expect(models.length).toBeGreaterThan(0);

    // Verify model metadata fields
    const first = models[0];
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('key');
    expect(first).toHaveProperty('size_bytes');
    expect(first).toHaveProperty('format');

    // Count loaded vs available
    const loaded = models.filter((m: any) => m.loaded_instances && m.loaded_instances.length > 0);
    console.log(`  Total: ${models.length} models, ${loaded.length} currently loaded`);

    // Log each model
    for (const m of models.slice(0, 10)) {
      const isLoaded = m.loaded_instances?.length > 0 ? '✓ LOADED' : '  available';
      const sizeMB = (m.size_bytes / 1024 / 1024).toFixed(0);
      console.log(`  ${isLoaded} | ${m.key} | ${m.params_string || '?'} | ${sizeMB} MB`);
    }
    if (models.length > 10) {
      console.log(`  ... and ${models.length - 10} more`);
    }
  });

  test('Loaded models have instance config details', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    const models = body.models || body.data || [];
    const loaded = models.filter((m: any) => m.loaded_instances && m.loaded_instances.length > 0);

    if (loaded.length === 0) {
      console.log('  No models currently loaded — skipping');
      test.skip();
      return;
    }

    for (const m of loaded) {
      const inst = m.loaded_instances[0];
      expect(inst).toHaveProperty('id');
      expect(inst).toHaveProperty('config');
      expect(inst.config).toHaveProperty('context_length');
      console.log(`  ${m.key}: ctx=${inst.config.context_length}, flash=${inst.config.flash_attention ?? 'n/a'}`);
    }
  });

  test('Model capabilities are reported', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    const models = body.models || body.data || [];
    const llms = models.filter((m: any) => m.type === 'llm');

    for (const m of llms.slice(0, 5)) {
      if (m.capabilities) {
        console.log(`  ${m.key}: vision=${m.capabilities.vision}, tool_use=${m.capabilities.trained_for_tool_use}`);
      }
    }
  });
});

// ─── Model Load / Unload ────────────────────────────────────────────────────

test.describe('Model Management — Load / Unload', () => {
  // We use a small model for load/unload tests to avoid long wait times
  const SMALL_MODEL = process.env.LM_TEST_SMALL_MODEL || 'Nerdsking/nerdsking-python-coder-3b-i';

  test('POST /api/v1/models/load loads a model with config', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/models/load`, {
      headers: authHeaders(),
      data: {
        model: SMALL_MODEL,
        context_length: 4096,
        flash_attention: true,
        echo_load_config: true,
      },
      timeout: 120000, // 2 min for model loading
    });

    // Model may already be loaded (200) or load successfully (200)
    // May also get 400 if model not found locally
    if (response.status() === 400 || response.status() === 404) {
      const err = await response.text();
      console.log(`  Model not available: ${err.substring(0, 200)}`);
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body).toHaveProperty('instance_id');
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('loaded');
    expect(body).toHaveProperty('load_time_seconds');

    console.log(`  Loaded: ${body.instance_id}`);
    console.log(`  Load time: ${body.load_time_seconds.toFixed(2)}s`);

    if (body.load_config) {
      console.log(`  Context: ${body.load_config.context_length}`);
      console.log(`  Flash attention: ${body.load_config.flash_attention}`);
      if (body.load_config.num_experts) {
        console.log(`  MoE experts: ${body.load_config.num_experts}`);
      }
    }
  });

  test('POST /api/v1/models/unload unloads a model', async ({ request }) => {
    // First check what's loaded
    const listResp = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    const listBody = await listResp.json();
    const models = listBody.models || listBody.data || [];
    const loaded = models.filter((m: any) => m.loaded_instances && m.loaded_instances.length > 0);

    if (loaded.length <= 1) {
      console.log('  Only 0-1 models loaded — skipping unload to avoid disrupting active model');
      test.skip();
      return;
    }

    // Unload the last loaded model (keep first one active)
    const toUnload = loaded[loaded.length - 1];
    const instanceId = toUnload.loaded_instances[0].id;

    const response = await request.post(`${LM_STUDIO_URL}/api/v1/models/unload`, {
      headers: authHeaders(),
      data: { instance_id: instanceId },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('instance_id');
    console.log(`  Unloaded: ${body.instance_id}`);
  });

  test('Load with MoE num_experts parameter', async ({ request }) => {
    // Test MoE-specific load config — uses qwen3-coder-30b if available
    const MOE_MODEL = process.env.LM_TEST_MOE_MODEL || 'unsloth/qwen3-coder-30b-a3b-instruct';

    const response = await request.post(`${LM_STUDIO_URL}/api/v1/models/load`, {
      headers: authHeaders(),
      data: {
        model: MOE_MODEL,
        context_length: 8192,
        flash_attention: true,
        num_experts: 4,
        echo_load_config: true,
      },
      timeout: 180000, // 3 min for large MoE
    });

    if (response.status() === 400 || response.status() === 404) {
      console.log(`  MoE model not available — skipping`);
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();
    console.log(`  MoE loaded: ${body.instance_id}, time: ${body.load_time_seconds?.toFixed(2)}s`);
    if (body.load_config?.num_experts) {
      console.log(`  Experts: ${body.load_config.num_experts}`);
    }
  });
});

// ─── Stateful Model Switching ───────────────────────────────────────────────

test.describe('Model Switching — Stateful Continuation', () => {
  test('Same-model continuation via previous_response_id', async ({ request }) => {
    // Step 1: Start a conversation
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i',
        input: 'Remember this: the secret code is PIXELCLAW-42.',
        max_output_tokens: 50,
      },
      timeout: 60000,
    });

    if (r1.status() !== 200) {
      console.log(`  Chat failed: ${r1.status()}`);
      test.skip();
      return;
    }

    const body1 = await r1.json();
    expect(body1).toHaveProperty('response_id');
    const rid = body1.response_id;
    console.log(`  Turn 1 response_id: ${rid}`);

    // Step 2: Continue with previous_response_id
    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i',
        input: 'What was the secret code I told you?',
        previous_response_id: rid,
        max_output_tokens: 50,
      },
      timeout: 60000,
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    expect(body2).toHaveProperty('response_id');
    expect(body2.response_id).not.toBe(rid);

    const msg = body2.output?.find((o: any) => o.type === 'message');
    console.log(`  Turn 2: ${msg?.content?.substring(0, 120)}`);
  });

  test('Cross-model context replay (memory-based switching)', async ({ request }) => {
    // Simulate what PixelClaw does when switching models:
    // 1. Chat with Model A, get response
    // 2. Extract context summary
    // 3. Chat with Model B, injecting summary as system_prompt

    const MODEL_A = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';

    // Step 1: Chat with Model A
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_A,
        input: 'Write a Python function to calculate fibonacci numbers.',
        max_output_tokens: 150,
      },
      timeout: 60000,
    });

    if (r1.status() !== 200) {
      test.skip();
      return;
    }

    const body1 = await r1.json();
    const modelAResponse = body1.output?.find((o: any) => o.type === 'message')?.content || '';
    console.log(`  Model A response: ${modelAResponse.substring(0, 100)}...`);

    // Step 2: "Switch" to same model with context replay
    // In production, this would be a DIFFERENT model loaded via /api/v1/models/load
    const contextSummary = `Previous conversation context: User asked for a fibonacci function. The assistant provided: ${modelAResponse.substring(0, 200)}`;

    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_A,
        system_prompt: contextSummary,
        input: 'Now add memoization to the fibonacci function from our previous conversation.',
        max_output_tokens: 200,
        store: false, // Don't store this as a new conversation
      },
      timeout: 60000,
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    const modelBResponse = body2.output?.find((o: any) => o.type === 'message')?.content || '';
    console.log(`  Context replay response: ${modelBResponse.substring(0, 100)}...`);
    // The model should reference fibonacci/memoization from the injected context
    expect(modelBResponse.length).toBeGreaterThan(0);
  });

  test('Conversation branching with response_id', async ({ request }) => {
    const MODEL = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';

    // Root message
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: { model: MODEL, input: 'Pick a number between 1 and 10.', max_output_tokens: 20 },
      timeout: 60000,
    });

    if (r1.status() !== 200) { test.skip(); return; }
    const body1 = await r1.json();
    const rootId = body1.response_id;

    // Branch A: ask to double it
    const rA = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: { model: MODEL, input: 'Double that number.', previous_response_id: rootId, max_output_tokens: 20 },
      timeout: 60000,
    });

    // Branch B: ask to halve it (from same root)
    const rB = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: { model: MODEL, input: 'Halve that number.', previous_response_id: rootId, max_output_tokens: 20 },
      timeout: 60000,
    });

    expect(rA.status()).toBe(200);
    expect(rB.status()).toBe(200);

    const bodyA = await rA.json();
    const bodyB = await rB.json();

    // Both branches should have different response_ids
    expect(bodyA.response_id).not.toBe(bodyB.response_id);
    console.log(`  Root: ${rootId}`);
    console.log(`  Branch A: ${bodyA.response_id}`);
    console.log(`  Branch B: ${bodyB.response_id}`);
  });
});

// ─── Multi-Model Performance ────────────────────────────────────────────────

test.describe('Model Performance — Comparison', () => {
  test('Benchmark loaded model response time and throughput', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    const body = await response.json();
    const models = body.models || body.data || [];
    const loaded = models.filter((m: any) =>
      m.type === 'llm' && m.loaded_instances && m.loaded_instances.length > 0
    );

    if (loaded.length === 0) {
      console.log('  No LLM models loaded — skipping benchmark');
      test.skip();
      return;
    }

    for (const m of loaded) {
      const instanceId = m.loaded_instances[0].id;
      const start = Date.now();

      const chatResp = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
        headers: authHeaders(),
        data: {
          model: instanceId,
          input: 'Reply with just the word OK.',
          max_output_tokens: 10,
          temperature: 0.0,
          store: false,
        },
        timeout: 30000,
      });

      const elapsed = Date.now() - start;

      if (chatResp.status() === 200) {
        const chatBody = await chatResp.json();
        const stats = chatBody.stats;
        console.log(`  ${instanceId}:`);
        console.log(`    Wall: ${elapsed}ms | TPS: ${stats?.tokens_per_second?.toFixed(1) || '?'} | TTFT: ${stats?.time_to_first_token_seconds?.toFixed(3) || '?'}s`);
        console.log(`    Input: ${stats?.input_tokens || '?'} tok | Output: ${stats?.total_output_tokens || '?'} tok`);
      } else {
        console.log(`  ${instanceId}: FAILED (${chatResp.status()})`);
      }
    }
  });
});
