/**
 * PixelClaw E2E — LM Studio Native REST API Tests
 *
 * Tests the native v1 REST API at /api/v1/* endpoints.
 * This is LM Studio's own API format (NOT OpenAI-compatible).
 *
 * Key differences from OpenAI-compat:
 *   - Uses `input` (string) instead of `messages` (array)
 *   - Uses `max_output_tokens` instead of `max_tokens`
 *   - Uses `integrations` for MCP (not `tools`)
 *   - Returns `output[]` (not `choices[]`)
 *   - Returns `stats` (not `usage`)
 *   - Returns `response_id` for stateful chats
 *   - Returns `model_instance_id` instead of `model`
 *
 * Docs: https://lmstudio.ai/docs/developer/rest
 */

import { test, expect } from '@playwright/test';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234';
const MODEL_ID = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';
const LM_API_TOKEN = process.env.LM_API_TOKEN || '';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LM_API_TOKEN) {
    headers['Authorization'] = `Bearer ${LM_API_TOKEN}`;
  }
  return headers;
}

// Pre-flight check: skip all tests if LM Studio is unreachable
test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      timeout: 5000,
      headers: authHeaders(),
    });
    if (response.status() !== 200) {
      console.log(`  LM Studio returned ${response.status()} — skipping native API tests`);
      test.skip();
    }
  } catch {
    console.log(`  LM Studio not reachable at ${LM_STUDIO_URL} — skipping native API tests`);
    test.skip();
  }
});

// ─── Native Chat (/api/v1/chat) ─────────────────────────────────────────────

test.describe('Native API — /api/v1/chat', () => {
  test('POST /api/v1/chat with string input', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What is 2+2? Reply with just the number.',
        max_output_tokens: 20,
        temperature: 0.1,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Native response structure
    expect(body).toHaveProperty('model_instance_id');
    expect(body).toHaveProperty('output');
    expect(Array.isArray(body.output)).toBe(true);
    expect(body.output.length).toBeGreaterThan(0);

    // First output should be a message
    const msg = body.output.find((o: any) => o.type === 'message');
    expect(msg).toBeTruthy();
    expect(msg.content.length).toBeGreaterThan(0);
    console.log(`  Response: ${msg.content.substring(0, 100)}`);

    // Stats block
    expect(body).toHaveProperty('stats');
    expect(body.stats).toHaveProperty('input_tokens');
    expect(body.stats).toHaveProperty('total_output_tokens');
    expect(body.stats).toHaveProperty('tokens_per_second');
    expect(body.stats).toHaveProperty('time_to_first_token_seconds');
    console.log(`  Speed: ${body.stats.tokens_per_second.toFixed(1)} tok/s, TTFT: ${body.stats.time_to_first_token_seconds.toFixed(3)}s`);
  });

  test('POST /api/v1/chat with system_prompt', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What is your name?',
        system_prompt: 'You are PixelClaw, a helpful coding assistant. Always introduce yourself by name.',
        max_output_tokens: 50,
        temperature: 0.1,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    const msg = body.output.find((o: any) => o.type === 'message');
    expect(msg).toBeTruthy();
    console.log(`  System prompt response: ${msg.content.substring(0, 120)}`);
  });

  test('POST /api/v1/chat with streaming', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'Say hello',
        max_output_tokens: 20,
        stream: true,
      },
    });

    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('data:');
    console.log(`  Stream: ${text.length} chars`);
  });

  test('Extended parameters: temperature, top_p, top_k, min_p, repeat_penalty', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'Say OK',
        max_output_tokens: 10,
        temperature: 0.5,
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        repeat_penalty: 1.1,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.output.length).toBeGreaterThan(0);
    console.log(`  Extended params accepted`);
  });
});

// ─── Stateful Chats ─────────────────────────────────────────────────────────

test.describe('Native API — Stateful Chats', () => {
  test('response_id returned when store is true (default)', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'My favorite color is blue.',
        max_output_tokens: 30,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('response_id');
    expect(body.response_id).toMatch(/^resp_/);
    console.log(`  response_id: ${body.response_id}`);
  });

  test('Continue conversation with previous_response_id', async ({ request }) => {
    // First message
    const r1 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'My favorite color is blue.',
        max_output_tokens: 30,
      },
    });

    expect(r1.status()).toBe(200);
    const body1 = await r1.json();
    const responseId = body1.response_id;
    expect(responseId).toBeTruthy();

    // Follow-up using previous_response_id
    const r2 = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What color did I just mention?',
        previous_response_id: responseId,
        max_output_tokens: 30,
      },
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    expect(body2).toHaveProperty('response_id');
    expect(body2.response_id).not.toBe(responseId); // New response_id
    const msg = body2.output.find((o: any) => o.type === 'message');
    console.log(`  Follow-up: ${msg?.content?.substring(0, 100)}`);
  });

  test('Disable storage with store:false (no response_id)', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'Tell me a joke.',
        store: false,
        max_output_tokens: 50,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    // When store is false, response_id should not be present
    expect(body.response_id).toBeFalsy();
    console.log(`  store:false — no response_id returned`);
  });
});

// ─── MCP via API ────────────────────────────────────────────────────────────

test.describe('Native API — MCP Integrations', () => {
  test('Ephemeral MCP server integration (if enabled)', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What is the top trending model on hugging face?',
        integrations: [
          {
            type: 'ephemeral_mcp',
            server_label: 'huggingface',
            server_url: 'https://huggingface.co/mcp',
            allowed_tools: ['model_search'],
          },
        ],
        context_length: 8000,
        max_output_tokens: 200,
        temperature: 0,
      },
    });

    // May fail if "Allow per-request MCPs" is not enabled in Server Settings
    if (response.status() === 400 || response.status() === 403) {
      console.log(`  Ephemeral MCP not enabled (${response.status()}) — skipping`);
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Check for tool calls in output
    const toolCalls = body.output.filter((o: any) => o.type === 'tool_call');
    const messages = body.output.filter((o: any) => o.type === 'message');

    if (toolCalls.length > 0) {
      console.log(`  MCP tool called: ${toolCalls[0].tool}`);
      expect(toolCalls[0]).toHaveProperty('provider_info');
      expect(toolCalls[0].provider_info.type).toBe('ephemeral_mcp');
    }
    expect(messages.length).toBeGreaterThan(0);
  });

  test('Plugin-based MCP (mcp.json) integration', async ({ request }) => {
    // This test requires "Allow calling servers from mcp.json" + auth enabled
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'List the files in the current directory',
        integrations: ['mcp/filesystem'],
        context_length: 4000,
        max_output_tokens: 100,
      },
    });

    // Will likely fail unless filesystem MCP is configured in mcp.json
    if (response.status() === 400 || response.status() === 403 || response.status() === 404) {
      console.log(`  mcp/filesystem not available (${response.status()}) — skipping`);
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();
    console.log(`  Plugin MCP response received with ${body.output.length} output items`);
  });
});

// ─── Model Management ───────────────────────────────────────────────────────

test.describe('Native API — Model Management', () => {
  test('GET /api/v1/models lists loaded models with details', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThan(0);

    const model = body.data[0];
    expect(model).toHaveProperty('id');
    console.log(`  First model: ${model.id}`);
  });
});

// ─── Image Input ────────────────────────────────────────────────────────────

test.describe('Native API — Multimodal', () => {
  test('POST /api/v1/chat accepts array input with text type', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: [
          { type: 'message', content: 'What is 1+1? Just the number.' },
        ],
        max_output_tokens: 10,
      },
    });

    // Array input may not be supported by all models
    if (response.status() === 400) {
      console.log('  Array input not supported by this model — skipping');
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.output.length).toBeGreaterThan(0);
    console.log(`  Array input accepted`);
  });
});

// ─── Performance ────────────────────────────────────────────────────────────

test.describe('Native API — Performance', () => {
  test('/api/v1/chat responds within 30s with stats', async ({ request }) => {
    const start = Date.now();

    const response = await request.post(`${LM_STUDIO_URL}/api/v1/chat`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'Reply with just the word OK.',
        max_output_tokens: 10,
        temperature: 0.0,
      },
    });

    const elapsed = Date.now() - start;
    expect(response.status()).toBe(200);

    const body = await response.json();
    const stats = body.stats;
    console.log(`  Wall time: ${elapsed}ms`);
    console.log(`  Tokens/sec: ${stats.tokens_per_second.toFixed(1)}`);
    console.log(`  TTFT: ${stats.time_to_first_token_seconds.toFixed(3)}s`);
    console.log(`  Input tokens: ${stats.input_tokens}, Output tokens: ${stats.total_output_tokens}`);

    if (stats.model_load_time_seconds) {
      console.log(`  Model load time: ${stats.model_load_time_seconds.toFixed(2)}s (JIT loaded)`);
    }

    expect(elapsed).toBeLessThan(30000);
    expect(stats.tokens_per_second).toBeGreaterThan(0);
  });
});
