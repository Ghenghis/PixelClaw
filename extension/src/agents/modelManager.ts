/**
 * PixelClaw Model Manager
 *
 * Manages dynamic model loading, unloading, and switching via LM Studio's
 * native REST API. Handles VRAM-aware scheduling and context preservation
 * across model transitions.
 *
 * API Endpoints:
 *   GET  /api/v1/models        — List models + loaded instances
 *   POST /api/v1/models/load   — Load model into VRAM
 *   POST /api/v1/models/unload — Unload model from VRAM
 *   POST /api/v1/chat          — Stateful chat (response_id continuation)
 */

import type { ModelState } from './protocol.js';
import { withRetry, withTimeout, withFallback, CircuitBreaker, checkLmStudioHealth, type HealthStatus } from './retry.js';

export interface ModelManagerConfig {
  /** LM Studio base URL (e.g., "http://100.117.198.97:1234") */
  baseUrl: string;
  /** API authentication token */
  apiToken?: string;
  /** Maximum models loaded simultaneously */
  parallelModelsMax: number;
  /** Auto-unload after idle minutes */
  autoUnloadIdleMinutes: number;
  /** Default context length for new loads */
  defaultContextLength: number;
  /** Default context length for MoE models */
  moeContextLength: number;
  /** Prefer flash attention when loading */
  preferFlashAttention: boolean;
}

const DEFAULT_CONFIG: ModelManagerConfig = {
  baseUrl: 'http://100.117.198.97:1234',
  parallelModelsMax: 2,
  autoUnloadIdleMinutes: 30,
  defaultContextLength: 8192,
  moeContextLength: 16384,
  preferFlashAttention: true,
};

export class ModelManager {
  private config: ModelManagerConfig;
  private models: Map<string, ModelState> = new Map();
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private circuitBreaker: CircuitBreaker;

  constructor(config?: Partial<ModelManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.circuitBreaker = new CircuitBreaker(5, 60000, 2);
  }

  // ─── Health ───────────────────────────────────────────────────────────

  /**
   * Check if LM Studio is reachable. Returns health status with latency.
   */
  async healthCheck(): Promise<HealthStatus> {
    return checkLmStudioHealth(this.config.baseUrl, this.authHeaders());
  }

  /**
   * Get circuit breaker state (closed = healthy, open = failing).
   */
  getCircuitState() {
    return this.circuitBreaker.getState();
  }

  // ─── Headers ──────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiToken) {
      headers['Authorization'] = `Bearer ${this.config.apiToken}`;
    }
    return headers;
  }

  // ─── Discovery ────────────────────────────────────────────────────────

  /**
   * Fetch all models from LM Studio (loaded + available).
   * Updates internal model state tracking.
   */
  async discoverModels(): Promise<ModelState[]> {
    const url = `${this.config.baseUrl}/api/v1/models`;
    const resp = await withRetry(
      () => this.circuitBreaker.execute(() => fetch(url, { headers: this.authHeaders() })),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        onRetry: (attempt, err) => console.warn(`[ModelManager] Discovery retry ${attempt}:`, err),
      },
    );

    if (!resp.ok) {
      throw new Error(`Model discovery failed: ${resp.status} ${resp.statusText}`);
    }

    const body = await resp.json() as { models: Array<{
      type: string;
      key: string;
      size_bytes: number;
      loaded_instances: Array<{ id: string; config: Record<string, unknown> }>;
      architecture?: string;
      quantization?: { name: string };
      capabilities?: { vision: boolean; trained_for_tool_use: boolean };
    }> };

    const result: ModelState[] = [];

    for (const m of body.models) {
      if (m.type !== 'llm') continue;

      const isLoaded = m.loaded_instances.length > 0;
      const state: ModelState = {
        key: m.key,
        instanceId: isLoaded ? m.loaded_instances[0].id : null,
        isLoaded,
        loadConfig: isLoaded ? {
          context_length: m.loaded_instances[0].config.context_length as number,
          flash_attention: m.loaded_instances[0].config.flash_attention as boolean | undefined,
          num_experts: m.loaded_instances[0].config.num_experts as number | undefined,
          eval_batch_size: m.loaded_instances[0].config.eval_batch_size as number | undefined,
        } : undefined,
        sizeGb: m.size_bytes / (1024 * 1024 * 1024),
        activeAgentIds: this.models.get(m.key)?.activeAgentIds || [],
      };

      if (isLoaded) {
        state.lastLoadedAt = this.models.get(m.key)?.lastLoadedAt || Date.now();
      }

      this.models.set(m.key, state);
      result.push(state);
    }

    return result;
  }

  /**
   * Get currently loaded models.
   */
  getLoadedModels(): ModelState[] {
    return Array.from(this.models.values()).filter(m => m.isLoaded);
  }

  /**
   * Get a specific model's state.
   */
  getModel(key: string): ModelState | undefined {
    return this.models.get(key);
  }

  // ─── Load / Unload ────────────────────────────────────────────────────

  /**
   * Load a model into VRAM. Handles VRAM management by unloading
   * idle models if the parallel limit is reached.
   */
  async loadModel(modelKey: string, options?: {
    contextLength?: number;
    flashAttention?: boolean;
    numExperts?: number;
    evalBatchSize?: number;
    forAgentId?: string;
  }): Promise<{ instanceId: string; loadTimeSeconds: number }> {
    // Check if already loaded
    const existing = this.models.get(modelKey);
    if (existing?.isLoaded && existing.instanceId) {
      console.log(`[ModelManager] ${modelKey} already loaded as ${existing.instanceId}`);
      if (options?.forAgentId) {
        this.bindAgentToModel(modelKey, options.forAgentId);
      }
      this.resetIdleTimer(modelKey);
      return { instanceId: existing.instanceId, loadTimeSeconds: 0 };
    }

    // Check parallel limit — unload idle models if needed
    const loaded = this.getLoadedModels();
    if (loaded.length >= this.config.parallelModelsMax) {
      const toUnload = this.findLeastUsedModel(loaded);
      if (toUnload) {
        console.log(`[ModelManager] Parallel limit reached. Unloading idle model: ${toUnload.key}`);
        await this.unloadModel(toUnload.key);
      }
    }

    // Build load request
    const loadReq: Record<string, unknown> = {
      model: modelKey,
      context_length: options?.contextLength || this.config.defaultContextLength,
      flash_attention: options?.flashAttention ?? this.config.preferFlashAttention,
      echo_load_config: true,
    };

    if (options?.numExperts) loadReq.num_experts = options.numExperts;
    if (options?.evalBatchSize) loadReq.eval_batch_size = options.evalBatchSize;

    console.log(`[ModelManager] Loading model: ${modelKey}...`);
    const url = `${this.config.baseUrl}/api/v1/models/load`;
    const resp = await withRetry(
      () => this.circuitBreaker.execute(() =>
        withTimeout(
          () => fetch(url, { method: 'POST', headers: this.authHeaders(), body: JSON.stringify(loadReq) }),
          180000,
          `Load ${modelKey}`,
        ),
      ),
      {
        maxAttempts: 2,
        initialDelayMs: 2000,
        onRetry: (attempt, err) => console.warn(`[ModelManager] Load retry ${attempt} for ${modelKey}:`, err),
        isRetryable: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          return !msg.includes('not found') && !msg.includes('404');
        },
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to load ${modelKey}: ${resp.status} ${errText.substring(0, 200)}`);
    }

    const body = await resp.json() as {
      instance_id: string;
      load_time_seconds: number;
      status: string;
      load_config?: Record<string, unknown>;
    };

    // Update internal state
    const state: ModelState = {
      key: modelKey,
      instanceId: body.instance_id,
      isLoaded: true,
      loadConfig: body.load_config ? {
        context_length: body.load_config.context_length as number,
        flash_attention: body.load_config.flash_attention as boolean | undefined,
        num_experts: body.load_config.num_experts as number | undefined,
        eval_batch_size: body.load_config.eval_batch_size as number | undefined,
      } : undefined,
      sizeGb: existing?.sizeGb || 0,
      lastLoadedAt: Date.now(),
      activeAgentIds: [],
    };

    this.models.set(modelKey, state);

    if (options?.forAgentId) {
      this.bindAgentToModel(modelKey, options.forAgentId);
    }

    this.resetIdleTimer(modelKey);
    console.log(`[ModelManager] Loaded ${modelKey} as ${body.instance_id} in ${body.load_time_seconds.toFixed(2)}s`);

    return { instanceId: body.instance_id, loadTimeSeconds: body.load_time_seconds };
  }

  /**
   * Unload a model from VRAM.
   */
  async unloadModel(modelKey: string): Promise<void> {
    const state = this.models.get(modelKey);
    if (!state?.isLoaded || !state.instanceId) {
      console.log(`[ModelManager] ${modelKey} is not loaded — skipping unload`);
      return;
    }

    // Warn if agents are still using this model
    if (state.activeAgentIds.length > 0) {
      console.warn(`[ModelManager] Warning: unloading ${modelKey} with ${state.activeAgentIds.length} active agents`);
    }

    const url = `${this.config.baseUrl}/api/v1/models/unload`;
    const resp = await withRetry(
      () => this.circuitBreaker.execute(() =>
        fetch(url, { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ instance_id: state.instanceId }) }),
      ),
      { maxAttempts: 2, initialDelayMs: 1000, onRetry: (a) => console.warn(`[ModelManager] Unload retry ${a}`) },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to unload ${modelKey}: ${resp.status} ${errText.substring(0, 200)}`);
    }

    // Update state
    state.isLoaded = false;
    state.instanceId = null;
    state.lastUnloadedAt = Date.now();
    state.activeAgentIds = [];

    // Clear idle timer
    this.clearIdleTimer(modelKey);
    console.log(`[ModelManager] Unloaded: ${modelKey}`);
  }

  // ─── Model Switching ──────────────────────────────────────────────────

  /**
   * Switch an agent from one model to another, preserving conversation context.
   *
   * Steps:
   * 1. Generate a context summary from the current model
   * 2. Unbind agent from current model
   * 3. Load new model (unloading old if needed)
   * 4. Bind agent to new model
   * 5. Return context summary for replay
   */
  async switchModel(params: {
    agentId: string;
    fromModelKey: string;
    toModelKey: string;
    conversationSummary: string;
    loadConfig?: {
      contextLength?: number;
      flashAttention?: boolean;
      numExperts?: number;
    };
  }): Promise<{
    newInstanceId: string;
    loadTimeSeconds: number;
    contextForReplay: string;
  }> {
    console.log(`[ModelManager] Switching agent ${params.agentId}: ${params.fromModelKey} → ${params.toModelKey}`);

    // Step 1: Unbind from current model
    this.unbindAgentFromModel(params.fromModelKey, params.agentId);

    // Step 2: Unload old model if no other agents are using it
    const fromState = this.models.get(params.fromModelKey);
    if (fromState?.isLoaded && fromState.activeAgentIds.length === 0) {
      console.log(`[ModelManager] No agents left on ${params.fromModelKey} — unloading`);
      await this.unloadModel(params.fromModelKey);
    }

    // Step 3: Load new model
    const { instanceId, loadTimeSeconds } = await this.loadModel(params.toModelKey, {
      contextLength: params.loadConfig?.contextLength,
      flashAttention: params.loadConfig?.flashAttention,
      numExperts: params.loadConfig?.numExperts,
      forAgentId: params.agentId,
    });

    // Step 4: Build context for replay
    const contextForReplay = [
      'You are continuing a conversation that was started with a different model.',
      'Here is the context from the previous conversation:',
      '',
      params.conversationSummary,
      '',
      'Continue from where the previous model left off.',
    ].join('\n');

    return {
      newInstanceId: instanceId,
      loadTimeSeconds,
      contextForReplay,
    };
  }

  // ─── Chat (Stateful) ─────────────────────────────────────────────────

  /**
   * Send a chat message to a model via LM Studio's native API.
   * Supports stateful continuation via response_id.
   */
  async chat(params: {
    modelInstanceId: string;
    input: string;
    systemPrompt?: string;
    previousResponseId?: string;
    maxOutputTokens?: number;
    temperature?: number;
    store?: boolean;
  }): Promise<{
    content: string;
    responseId?: string;
    stats?: Record<string, unknown>;
  }> {
    const body: Record<string, unknown> = {
      model: params.modelInstanceId,
      input: params.input,
    };

    if (params.systemPrompt) body.system_prompt = params.systemPrompt;
    if (params.previousResponseId) body.previous_response_id = params.previousResponseId;
    if (params.maxOutputTokens) body.max_output_tokens = params.maxOutputTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.store !== undefined) body.store = params.store;

    const url = `${this.config.baseUrl}/api/v1/chat`;
    const resp = await withRetry(
      () => this.circuitBreaker.execute(() =>
        withTimeout(
          () => fetch(url, { method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body) }),
          120000,
          'Chat',
        ),
      ),
      {
        maxAttempts: 2,
        initialDelayMs: 1000,
        onRetry: (a, err) => console.warn(`[ModelManager] Chat retry ${a}:`, err),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Chat failed: ${resp.status} ${errText.substring(0, 200)}`);
    }

    const result = await resp.json() as {
      output?: Array<{ type: string; content?: string }>;
      response_id?: string;
      stats?: Record<string, unknown>;
    };

    const content = result.output?.find(o => o.type === 'message')?.content || '';

    return {
      content,
      responseId: result.response_id,
      stats: result.stats,
    };
  }

  // ─── Agent-Model Binding ──────────────────────────────────────────────

  bindAgentToModel(modelKey: string, agentId: string): void {
    const state = this.models.get(modelKey);
    if (!state) return;
    if (!state.activeAgentIds.includes(agentId)) {
      state.activeAgentIds.push(agentId);
    }
    this.resetIdleTimer(modelKey);
  }

  unbindAgentFromModel(modelKey: string, agentId: string): void {
    const state = this.models.get(modelKey);
    if (!state) return;
    state.activeAgentIds = state.activeAgentIds.filter(id => id !== agentId);
    if (state.activeAgentIds.length === 0) {
      this.resetIdleTimer(modelKey);
    }
  }

  // ─── Idle Timer ───────────────────────────────────────────────────────

  private resetIdleTimer(modelKey: string): void {
    this.clearIdleTimer(modelKey);

    const state = this.models.get(modelKey);
    if (!state?.isLoaded) return;

    // Only start idle timer if no agents are using this model
    if (state.activeAgentIds.length > 0) return;

    const timer = setTimeout(async () => {
      const current = this.models.get(modelKey);
      if (current?.isLoaded && current.activeAgentIds.length === 0) {
        console.log(`[ModelManager] Auto-unloading idle model: ${modelKey}`);
        try {
          await this.unloadModel(modelKey);
        } catch (err) {
          console.error(`[ModelManager] Auto-unload failed for ${modelKey}:`, err);
        }
      }
    }, this.config.autoUnloadIdleMinutes * 60 * 1000);

    this.idleTimers.set(modelKey, timer);
  }

  private clearIdleTimer(modelKey: string): void {
    const timer = this.idleTimers.get(modelKey);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(modelKey);
    }
  }

  /**
   * Find the least-used loaded model (fewest active agents, oldest load time).
   */
  private findLeastUsedModel(loaded: ModelState[]): ModelState | null {
    if (loaded.length === 0) return null;

    return loaded
      .filter(m => m.activeAgentIds.length === 0)
      .sort((a, b) => (a.lastLoadedAt || 0) - (b.lastLoadedAt || 0))[0] || null;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
  }
}
