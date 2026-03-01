/**
 * PixelClaw E2E — LM Studio OpenAI-Compatible API Tests
 *
 * Tests the OpenAI-compatible endpoints at /v1/*
 * These are the endpoints used by standard OpenAI client libraries.
 *
 * LM Studio 0.4.x API Layers:
 *   - Native REST API:      /api/v1/*  (see lmstudio.native.ts)
 *   - OpenAI-compatible:    /v1/*      (this file)
 *   - Anthropic-compatible: /v1/messages
 *
 * Docs: https://lmstudio.ai/docs/developer/openai-compat
 */

import { test, expect } from '@playwright/test';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234';
const MODEL_ID = process.env.LM_STUDIO_MODEL || 'nerdstking-python-coder-7b-i';
const LM_API_TOKEN = process.env.LM_API_TOKEN || '';

/** Build headers — includes Authorization if LM_API_TOKEN is set */
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
    const response = await request.get(`${LM_STUDIO_URL}/v1/models`, {
      timeout: 5000,
      headers: authHeaders(),
    });
    if (response.status() !== 200) {
      console.log(`  LM Studio returned ${response.status()} — skipping`);
      test.skip();
    }
  } catch {
    console.log(`  LM Studio not reachable at ${LM_STUDIO_URL} — skipping all OpenAI-compat tests`);
    test.skip();
  }
});

// ─── Server Health ──────────────────────────────────────────────────────────

test.describe('OpenAI-Compat — Server Health', () => {
  test('GET /v1/models returns loaded models', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/v1/models`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const modelIds = body.data.map((m: any) => m.id);
    console.log(`  Loaded models: ${modelIds.join(', ')}`);
    expect(modelIds.some((id: string) =>
      id.includes('nerdstking') || id.includes('python-coder')
    )).toBe(true);
  });

  test('GET /api/v1/models (native) also works', async ({ request }) => {
    const response = await request.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(body.data.length).toBeGreaterThan(0);
  });
});

// ─── Chat Completions (/v1/chat/completions) ────────────────────────────────

test.describe('OpenAI-Compat — Chat Completions', () => {
  test('POST /v1/chat/completions returns valid response', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Reply in one sentence.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        max_tokens: 50,
        temperature: 0.1,
        stream: false,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Validate OpenAI-compatible response structure
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('choices');
    expect(body.choices.length).toBeGreaterThan(0);
    expect(body.choices[0]).toHaveProperty('message');
    expect(body.choices[0].message).toHaveProperty('content');
    expect(body.choices[0].message.role).toBe('assistant');

    const content = body.choices[0].message.content;
    console.log(`  Response: ${content.substring(0, 120)}`);
    expect(content.length).toBeGreaterThan(0);

    // Validate usage stats
    expect(body).toHaveProperty('usage');
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    console.log(`  Tokens: ${body.usage.total_tokens} (prompt ${body.usage.prompt_tokens}, completion ${body.usage.completion_tokens})`);
  });

  test('Streaming via SSE works', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [{ role: 'user', content: 'Say hello in exactly 3 words.' }],
        max_tokens: 20,
        temperature: 0.1,
        stream: true,
      },
    });

    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('data:');
    // Last event should be [DONE]
    expect(text).toContain('[DONE]');
    console.log(`  Stream: ${text.length} chars`);
  });

  test('Tool calling (OpenAI function format)', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [{ role: 'user', content: 'What is the current weather in London?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                },
                required: ['location'],
              },
            },
          },
        ],
        tool_choice: 'auto',
        max_tokens: 100,
        temperature: 0.1,
        stream: false,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.choices.length).toBeGreaterThan(0);

    const choice = body.choices[0];
    const hasToolCall = choice.message.tool_calls && choice.message.tool_calls.length > 0;
    const hasContent = choice.message.content && choice.message.content.length > 0;
    expect(hasToolCall || hasContent).toBe(true);

    if (hasToolCall) {
      console.log(`  Tool: ${choice.message.tool_calls[0].function.name}(${choice.message.tool_calls[0].function.arguments})`);
    } else {
      console.log(`  Model chose text instead of tool call`);
    }
  });

  test('Supported payload parameters accepted', async ({ request }) => {
    // Tests all documented params: top_p, top_k, repeat_penalty, seed, stop
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10,
        temperature: 0.5,
        top_p: 0.9,
        top_k: 40,
        repeat_penalty: 1.1,
        seed: 42,
        stop: ['\n'],
        stream: false,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.choices.length).toBeGreaterThan(0);
    console.log(`  All extended params accepted`);
  });
});

// ─── Responses API (/v1/responses) — New in LM Studio 0.3.29+ ──────────────

test.describe('OpenAI-Compat — Responses API', () => {
  test('POST /v1/responses returns valid response', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/responses`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What is 2+2? Reply with just the number.',
      },
    });

    // /v1/responses may not be available on all versions
    if (response.status() === 404) {
      console.log('  /v1/responses not available — skipping');
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('output');
    console.log(`  Response ID: ${body.id}`);
  });

  test('Stateful follow-up via previous_response_id', async ({ request }) => {
    // First request
    const r1 = await request.post(`${LM_STUDIO_URL}/v1/responses`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'My favorite color is blue.',
      },
    });

    if (r1.status() === 404) {
      console.log('  /v1/responses not available — skipping');
      test.skip();
      return;
    }

    expect(r1.status()).toBe(200);
    const body1 = await r1.json();
    expect(body1).toHaveProperty('id');
    const responseId = body1.id;
    console.log(`  First response_id: ${responseId}`);

    // Follow-up referencing previous response
    const r2 = await request.post(`${LM_STUDIO_URL}/v1/responses`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'What color did I just mention?',
        previous_response_id: responseId,
      },
    });

    expect(r2.status()).toBe(200);
    const body2 = await r2.json();
    expect(body2).toHaveProperty('output');
    console.log(`  Follow-up response_id: ${body2.id}`);
  });

  test('Streaming via SSE with stream:true', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/responses`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        input: 'Hello',
        stream: true,
      },
    });

    if (response.status() === 404) {
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);
    const text = await response.text();
    // SSE events: response.created, response.output_text.delta, response.completed
    expect(text).toContain('data:');
    console.log(`  Stream: ${text.length} chars`);
  });
});

// ─── Error Handling ─────────────────────────────────────────────────────────

test.describe('OpenAI-Compat — Error Handling', () => {
  test('Invalid model returns 400 or 404', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: 'nonexistent-model-xyz',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      },
    });

    // JIT loading may return 200 if it finds a match; otherwise 400/404
    expect([200, 400, 404]).toContain(response.status());
    console.log(`  Invalid model → ${response.status()}`);
  });

  test('Empty messages array returns error', async ({ request }) => {
    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [],
        max_tokens: 10,
      },
    });

    expect([400, 422, 500]).toContain(response.status());
    console.log(`  Empty messages → ${response.status()}`);
  });
});

// ─── Performance Baseline ───────────────────────────────────────────────────

test.describe('OpenAI-Compat — Performance', () => {
  test('Chat completion responds within 30s', async ({ request }) => {
    const start = Date.now();

    const response = await request.post(`${LM_STUDIO_URL}/v1/chat/completions`, {
      headers: authHeaders(),
      data: {
        model: MODEL_ID,
        messages: [{ role: 'user', content: 'Reply with just the word OK.' }],
        max_tokens: 10,
        temperature: 0.0,
        stream: false,
      },
    });

    const elapsed = Date.now() - start;
    expect(response.status()).toBe(200);

    const body = await response.json();
    console.log(`  Time: ${elapsed}ms | Tokens/sec: ${(body.usage.completion_tokens / (elapsed / 1000)).toFixed(1)}`);
    expect(elapsed).toBeLessThan(30000);
  });
});
