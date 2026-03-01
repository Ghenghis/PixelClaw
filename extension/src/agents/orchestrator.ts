/**
 * PixelClaw Agent Orchestrator
 *
 * Top-level coordinator that wires MessageBus, ModelManager, and MemoryStore
 * into a unified agent chat system. Handles:
 *
 *   - Agent lifecycle (create, destroy, status)
 *   - Task decomposition and delegation
 *   - Model switching with context preservation
 *   - Inter-agent conversation routing
 *   - Seamless handoffs between agents
 *
 * Usage:
 *   const orch = new AgentOrchestrator({ baseUrl: 'http://...', workspaceDir: '...' });
 *   await orch.initialize();
 *   const thread = await orch.submitTask('Fix the login bug in auth.ts');
 */

import { MessageBus } from './messageBus.js';
import { ModelManager, type ModelManagerConfig } from './modelManager.js';
import { MemoryStore } from './memoryStore.js';
import { withRetry, withFallback, type HealthStatus } from './retry.js';
import type {
  AgentIdentity,
  AgentMessage,
  AgentRole,
  AgentStatus,
  BusEvent,
  ConversationThread,
  TaskResultPayload,
} from './protocol.js';

// ─── Default Agent Templates ────────────────────────────────────────────────

const AGENT_TEMPLATES: Record<AgentRole, {
  name: string;
  systemPrompt: string;
  defaultModel: string;
  capabilities: AgentRole[];
}> = {
  orchestrator: {
    name: 'Orchestrator',
    systemPrompt: [
      'You are the PixelClaw Orchestrator agent.',
      'Your job is to decompose complex tasks into subtasks and delegate them to specialist agents.',
      'You coordinate between agents, track progress, and ensure tasks are completed correctly.',
      'When delegating, choose the best agent for each subtask based on their capabilities.',
      'Always provide clear task descriptions and relevant context to delegate agents.',
    ].join('\n'),
    defaultModel: 'openai/gpt-oss-20b',
    capabilities: ['reasoning', 'chat'],
  },
  code: {
    name: 'CodeBot',
    systemPrompt: [
      'You are the PixelClaw Code agent.',
      'You write, edit, review, and debug code across multiple languages.',
      'You follow existing code style and conventions.',
      'You provide working, tested solutions with proper error handling.',
      'When you encounter a problem outside your expertise, request a handoff to the appropriate agent.',
    ].join('\n'),
    defaultModel: 'Nerdsking/nerdsking-python-coder-7b-i',
    capabilities: ['code', 'tool_use'],
  },
  reasoning: {
    name: 'Thinker',
    systemPrompt: [
      'You are the PixelClaw Reasoning agent.',
      'You analyze complex problems, make architecture decisions, and plan solutions.',
      'You think step-by-step and consider trade-offs carefully.',
      'You provide clear justifications for your recommendations.',
    ].join('\n'),
    defaultModel: 'openai/gpt-oss-20b',
    capabilities: ['reasoning', 'chat'],
  },
  vision: {
    name: 'EyeBot',
    systemPrompt: [
      'You are the PixelClaw Vision agent.',
      'You analyze screenshots, UI elements, images, and visual content.',
      'You describe what you see accurately and identify visual issues.',
      'You can help debug layout problems by examining rendered output.',
    ].join('\n'),
    defaultModel: 'lmstudio-community/qwen3-vl-4b',
    capabilities: ['vision'],
  },
  tool_use: {
    name: 'ToolBot',
    systemPrompt: [
      'You are the PixelClaw Tool agent.',
      'You execute MCP tools, call functions, and interact with external services.',
      'You format structured output correctly for tool calls.',
      'You handle errors gracefully and report results clearly.',
    ].join('\n'),
    defaultModel: 'Nerdsking/nerdsking-python-coder-7b-i',
    capabilities: ['tool_use', 'code'],
  },
  chat: {
    name: 'ChatBot',
    systemPrompt: [
      'You are the PixelClaw Chat agent.',
      'You handle general conversations, documentation, and explanations.',
      'You communicate clearly and concisely.',
    ].join('\n'),
    defaultModel: 'dphn/dolphin3.0-llama3.1-8b',
    capabilities: ['chat'],
  },
  evony: {
    name: 'EvonyBot',
    systemPrompt: [
      'You are the PixelClaw Evony specialist agent.',
      'You have deep knowledge of the Evony game mechanics, APIs, and data structures.',
      'You help with Evony-specific features, game data analysis, and strategy optimization.',
    ].join('\n'),
    defaultModel: 'Borg/evony-qwen3-8b-phase2@q8_0',
    capabilities: ['evony', 'chat'],
  },
};

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** LM Studio base URL */
  baseUrl: string;
  /** API token */
  apiToken?: string;
  /** Workspace directory for memory store */
  workspaceDir: string;
  /** Model manager config overrides */
  modelConfig?: Partial<ModelManagerConfig>;
  /** Auto-create default agents on initialize */
  autoCreateAgents?: boolean;
}

export class AgentOrchestrator {
  readonly bus: MessageBus;
  readonly models: ModelManager;
  readonly memory: MemoryStore;

  private config: OrchestratorConfig;
  private orchestratorId = 'agent-orchestrator';
  private agentCounter = 0;

  /** Fallback models per role — tried when default model fails to load */
  private static readonly FALLBACK_MODELS: Record<string, string[]> = {
    code: ['dphn/dolphin3.0-llama3.1-8b', 'openai/gpt-oss-20b'],
    reasoning: ['dphn/dolphin3.0-llama3.1-8b'],
    vision: [],
    tool_use: ['dphn/dolphin3.0-llama3.1-8b', 'openai/gpt-oss-20b'],
    chat: ['openai/gpt-oss-20b'],
    evony: ['dphn/dolphin3.0-llama3.1-8b'],
    orchestrator: ['dphn/dolphin3.0-llama3.1-8b'],
  };

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.bus = new MessageBus();
    this.models = new ModelManager({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      ...config.modelConfig,
    });
    this.memory = new MemoryStore(config.workspaceDir);

    // Wire up event handlers
    this.bus.on(this.handleBusEvent.bind(this));
  }

  // ─── Initialization ───────────────────────────────────────────────────

  /**
   * Initialize the orchestrator: discover models, create default agents.
   */
  async initialize(): Promise<void> {
    console.log('[Orchestrator] Initializing...');

    // Discover available models
    try {
      const models = await this.models.discoverModels();
      console.log(`[Orchestrator] Discovered ${models.length} models (${models.filter(m => m.isLoaded).length} loaded)`);
    } catch (err) {
      console.warn('[Orchestrator] Model discovery failed (LM Studio may be offline):', err);
    }

    // Register the orchestrator agent
    this.bus.registerAgent({
      id: this.orchestratorId,
      name: 'Orchestrator',
      role: 'orchestrator',
      capabilities: ['reasoning', 'chat'],
      modelInstanceId: null,
      modelKey: AGENT_TEMPLATES.orchestrator.defaultModel,
      status: 'idle',
      systemPrompt: AGENT_TEMPLATES.orchestrator.systemPrompt,
      lastActiveAt: Date.now(),
      activeThreadIds: [],
    });

    // Auto-create default agents
    if (this.config.autoCreateAgents !== false) {
      await this.createDefaultAgents();
    }

    console.log('[Orchestrator] Ready');
  }

  /**
   * Create default agents for each role.
   */
  private async createDefaultAgents(): Promise<void> {
    const roles: AgentRole[] = ['code', 'reasoning', 'vision', 'tool_use', 'chat'];

    for (const role of roles) {
      await this.createAgent(role);
    }
  }

  // ─── Agent Lifecycle ──────────────────────────────────────────────────

  /**
   * Create a new agent with the given role.
   */
  async createAgent(role: AgentRole, customName?: string): Promise<AgentIdentity> {
    const template = AGENT_TEMPLATES[role];
    if (!template) throw new Error(`Unknown agent role: ${role}`);

    const id = `agent-${role}-${++this.agentCounter}`;
    const agent: AgentIdentity = {
      id,
      name: customName || `${template.name} #${this.agentCounter}`,
      role,
      capabilities: template.capabilities,
      modelInstanceId: null,
      modelKey: template.defaultModel,
      status: 'idle',
      systemPrompt: template.systemPrompt,
      lastActiveAt: Date.now(),
      activeThreadIds: [],
    };

    this.bus.registerAgent(agent);
    console.log(`[Orchestrator] Created agent: ${id} (${role})`);
    return agent;
  }

  /**
   * Destroy an agent, freeing its model binding.
   */
  async destroyAgent(agentId: string): Promise<void> {
    const agent = this.bus.getAgent(agentId);
    if (!agent) return;

    // Unbind from model
    if (agent.modelKey) {
      this.models.unbindAgentFromModel(agent.modelKey, agentId);
    }

    this.bus.unregisterAgent(agentId);
    console.log(`[Orchestrator] Destroyed agent: ${agentId}`);
  }

  // ─── Task Submission ──────────────────────────────────────────────────

  /**
   * Submit a user task. The orchestrator decomposes it and delegates to agents.
   */
  async submitTask(task: string, options?: {
    requiredCapabilities?: AgentRole[];
    relevantFiles?: string[];
    timeoutMs?: number;
  }): Promise<ConversationThread> {
    console.log(`[Orchestrator] Task submitted: ${task.substring(0, 100)}`);

    // Determine required capabilities
    const caps = options?.requiredCapabilities || this.inferCapabilities(task);

    // Create a thread for this task
    const thread = this.bus.createThread(`Task: ${task.substring(0, 50)}`, [this.orchestratorId]);

    // Find and assign the best agent
    const assignment = this.bus.assignTask({
      from: this.orchestratorId,
      task,
      requiredCapabilities: caps,
      relevantFiles: options?.relevantFiles,
      timeoutMs: options?.timeoutMs,
      priorContext: this.memory.getProjectState('current_task') || undefined,
    });

    if (!assignment) {
      // No agent available — try to create one
      const newAgent = await this.createAgent(caps[0] || 'code');
      this.bus.send({
        from: this.orchestratorId,
        to: newAgent.id,
        type: 'task_assign',
        content: task,
        threadId: thread.id,
        payload: {
          kind: 'task_assign',
          task,
          requiredCapabilities: caps,
          relevantFiles: options?.relevantFiles,
          timeoutMs: options?.timeoutMs,
        },
      });
    }

    // Update project state
    this.memory.storeProjectState(this.orchestratorId, 'current_task', task);

    return thread;
  }

  /**
   * Execute an agent's turn: send input to the model and get a response.
   * Handles stateful continuation and context replay.
   */
  async executeAgentTurn(params: {
    agentId: string;
    threadId: string;
    input: string;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<{
    response: string;
    responseId?: string;
  }> {
    const agent = this.bus.getAgent(params.agentId);
    if (!agent) throw new Error(`Agent not found: ${params.agentId}`);
    if (!agent.modelKey) throw new Error(`Agent ${params.agentId} has no model assigned`);

    this.bus.updateAgentStatus(params.agentId, 'active');

    try {
      // Ensure model is loaded — with fallback to alternative models
      const instanceId = await this.loadModelWithFallback(agent);
      agent.modelInstanceId = instanceId;

      // Get previous response_id for stateful continuation
      const previousResponseId = this.bus.getLatestResponseId(params.threadId, params.agentId);

      // Build system prompt with context replay if needed
      let systemPrompt = agent.systemPrompt;
      if (!previousResponseId) {
        const contextReplay = this.memory.buildContextReplay(params.threadId, params.agentId);
        if (contextReplay) {
          systemPrompt = `${agent.systemPrompt}\n\n${contextReplay}`;
        }
      }

      // Send to LM Studio
      const result = await this.models.chat({
        modelInstanceId: instanceId,
        input: params.input,
        systemPrompt: previousResponseId ? undefined : systemPrompt,
        previousResponseId,
        maxOutputTokens: params.maxOutputTokens || 1000,
        temperature: params.temperature ?? 0.7,
      });

      // Track response_id for continuation
      if (result.responseId) {
        this.bus.trackResponseId(params.threadId, params.agentId, result.responseId);
      }

      // Store message in thread
      this.bus.send({
        from: params.agentId,
        to: null,
        type: 'chat',
        content: result.content,
        threadId: params.threadId,
        responseId: result.responseId,
        previousResponseId,
      });

      this.bus.updateAgentStatus(params.agentId, 'idle');
      return { response: result.content, responseId: result.responseId };
    } catch (err) {
      // Recovery: restore agent to idle (not stuck in 'active')
      this.bus.updateAgentStatus(params.agentId, 'error');
      this.memory.store({
        type: 'agent_knowledge',
        agentId: params.agentId,
        content: `executeAgentTurn failed: ${err instanceof Error ? err.message : String(err)}`,
        tags: ['error', 'turn_failure', params.threadId],
        ttlMs: 3600000,
      });
      console.error(`[Orchestrator] executeAgentTurn failed for ${params.agentId}:`, err);

      // Auto-recover: reset to idle after a short delay
      setTimeout(() => {
        const a = this.bus.getAgent(params.agentId);
        if (a && a.status === 'error') {
          this.bus.updateAgentStatus(params.agentId, 'idle');
          console.log(`[Orchestrator] Auto-recovered ${params.agentId} to idle`);
        }
      }, 5000);

      throw err;
    }
  }

  /**
   * Load a model for an agent with automatic fallback to alternative models.
   */
  private async loadModelWithFallback(agent: AgentIdentity): Promise<string> {
    const primaryKey = agent.modelKey!;
    const fallbacks = AgentOrchestrator.FALLBACK_MODELS[agent.role] || [];

    // Try primary model first
    const primary = async () => {
      const { instanceId } = await this.models.loadModel(primaryKey, { forAgentId: agent.id });
      return instanceId;
    };

    // Build fallback attempts
    const fallbackFns = fallbacks
      .filter(k => k !== primaryKey)
      .map(fallbackKey => async () => {
        console.warn(`[Orchestrator] Trying fallback model ${fallbackKey} for ${agent.id}`);
        agent.modelKey = fallbackKey;
        const { instanceId } = await this.models.loadModel(fallbackKey, { forAgentId: agent.id });
        return instanceId;
      });

    return withFallback(primary, fallbackFns, `Load model for ${agent.id}`);
  }

  // ─── Model Switching ──────────────────────────────────────────────────

  /**
   * Switch an agent to a different model, preserving conversation context.
   */
  async switchAgentModel(params: {
    agentId: string;
    newModelKey: string;
    threadId: string;
    reason: string;
  }): Promise<void> {
    const agent = this.bus.getAgent(params.agentId);
    if (!agent) throw new Error(`Agent not found: ${params.agentId}`);

    const oldModelKey = agent.modelKey;
    if (!oldModelKey) throw new Error(`Agent ${params.agentId} has no current model`);

    console.log(`[Orchestrator] Switching ${params.agentId}: ${oldModelKey} → ${params.newModelKey}`);
    this.bus.updateAgentStatus(params.agentId, 'switching_model');

    try {
      // Step 1: Generate conversation summary from the current model
      const thread = this.bus.getThread(params.threadId);
      const recentMessages = thread?.messages
        .filter(m => m.from === params.agentId)
        .slice(-5)
        .map(m => m.content)
        .join('\n---\n') || '';

      const summary = recentMessages
        ? `Agent ${agent.name} (${oldModelKey}) recent conversation:\n${recentMessages.substring(0, 2000)}`
        : 'No prior conversation context.';

      // Step 2: Store context in memory (do this BEFORE switch so context is safe)
      const responseChain = thread?.responseChains[params.agentId] || [];
      this.memory.storeConversationSummary({
        agentId: params.agentId,
        threadId: params.threadId,
        summary,
        modelKey: oldModelKey,
        responseChain,
      });

      // Step 3: Perform the model switch with retry
      const { newInstanceId } = await withRetry(
        () => this.models.switchModel({
          agentId: params.agentId,
          fromModelKey: oldModelKey,
          toModelKey: params.newModelKey,
          conversationSummary: summary,
        }),
        {
          maxAttempts: 2,
          initialDelayMs: 2000,
          onRetry: (a, err) => console.warn(`[Orchestrator] Switch retry ${a}:`, err),
        },
      );

      // Step 4: Update agent state
      agent.modelKey = params.newModelKey;
      agent.modelInstanceId = newInstanceId;

      // Step 5: Clear response chain (new model = new chain)
      if (thread) {
        thread.responseChains[params.agentId] = [];
      }

      // Step 6: Notify via bus
      this.bus.send({
        from: params.agentId,
        to: null,
        type: 'model_switch',
        content: `Switched from ${oldModelKey} to ${params.newModelKey}: ${params.reason}`,
        threadId: params.threadId,
        payload: {
          kind: 'model_switch',
          targetModelKey: params.newModelKey,
          reason: params.reason,
          preservedContext: summary,
        },
      });

      this.bus.updateAgentStatus(params.agentId, 'idle');
      console.log(`[Orchestrator] Switch complete: ${params.agentId} now on ${params.newModelKey}`);
    } catch (err) {
      // Recovery: restore agent to original model if switch failed
      console.error(`[Orchestrator] Model switch failed for ${params.agentId}:`, err);
      agent.modelKey = oldModelKey; // Roll back to original
      this.bus.updateAgentStatus(params.agentId, 'idle');
      this.memory.store({
        type: 'agent_knowledge',
        agentId: params.agentId,
        content: `Model switch failed (${oldModelKey} → ${params.newModelKey}): ${err instanceof Error ? err.message : String(err)}`,
        tags: ['error', 'model_switch_failure'],
        ttlMs: 3600000,
      });
      throw err;
    }
  }

  // ─── Agent Handoff ────────────────────────────────────────────────────

  /**
   * Hand off a conversation from one agent to another.
   * The receiving agent gets full context.
   */
  async handoffConversation(params: {
    fromAgentId: string;
    toAgentId: string;
    threadId: string;
    reason: string;
  }): Promise<void> {
    const fromAgent = this.bus.getAgent(params.fromAgentId);
    const toAgent = this.bus.getAgent(params.toAgentId);
    if (!fromAgent || !toAgent) throw new Error('Agent not found');

    // Build conversation summary
    const thread = this.bus.getThread(params.threadId);
    const messages = thread?.messages
      .slice(-10)
      .map(m => `[${m.from}]: ${m.content.substring(0, 200)}`)
      .join('\n') || '';

    const summary = `Handoff from ${fromAgent.name} to ${toAgent.name}.\nReason: ${params.reason}\nRecent conversation:\n${messages}`;

    // Store in memory for receiving agent
    this.memory.storeConversationSummary({
      agentId: params.toAgentId,
      threadId: params.threadId,
      summary,
      modelKey: fromAgent.modelKey || 'unknown',
      responseChain: thread?.responseChains[params.fromAgentId] || [],
    });

    // Send handoff message
    this.bus.handoff({
      from: params.fromAgentId,
      to: params.toAgentId,
      reason: params.reason,
      conversationSummary: summary,
      threadId: params.threadId,
      responseChain: thread?.responseChains[params.fromAgentId],
    });

    // Add receiving agent to thread
    if (thread && !thread.participants.includes(params.toAgentId)) {
      thread.participants.push(params.toAgentId);
    }
    if (!toAgent.activeThreadIds.includes(params.threadId)) {
      toAgent.activeThreadIds.push(params.threadId);
    }

    console.log(`[Orchestrator] Handoff: ${params.fromAgentId} → ${params.toAgentId} (${params.reason})`);
  }

  // ─── Event Handling ───────────────────────────────────────────────────

  private handleBusEvent(event: BusEvent): void {
    switch (event.type) {
      case 'message':
        this.handleMessage(event.message);
        break;
      case 'agent_status':
        if (event.status === 'error') {
          this.memory.store({
            type: 'agent_knowledge',
            agentId: event.agentId,
            content: `Agent entered error state`,
            tags: ['error', 'agent_status'],
            ttlMs: 3600000, // 1 hour
          });
        }
        break;
    }
  }

  private handleMessage(message: AgentMessage): void {
    // Auto-handle task results
    if (message.type === 'task_result' && message.payload?.kind === 'task_result') {
      const payload = message.payload as TaskResultPayload;
      this.memory.storeTaskResult({
        agentId: message.from,
        threadId: message.threadId,
        task: payload.summary,
        result: payload.summary,
        success: payload.success,
        files: payload.modifiedFiles,
      });
    }
  }

  // ─── Capability Inference ─────────────────────────────────────────────

  /**
   * Infer required capabilities from a task description.
   */
  private inferCapabilities(task: string): AgentRole[] {
    const lower = task.toLowerCase();
    const caps: AgentRole[] = [];

    if (/\b(code|fix|bug|function|class|implement|refactor|debug|test)\b/.test(lower)) {
      caps.push('code');
    }
    if (/\b(screenshot|image|visual|ui|layout|render|display)\b/.test(lower)) {
      caps.push('vision');
    }
    if (/\b(plan|design|architect|decide|analyze|strategy|think)\b/.test(lower)) {
      caps.push('reasoning');
    }
    if (/\b(tool|mcp|function.call|api|execute|run)\b/.test(lower)) {
      caps.push('tool_use');
    }
    if (/\b(evony|game|battle|troop|alliance)\b/.test(lower)) {
      caps.push('evony');
    }

    // Default to code if nothing matched
    if (caps.length === 0) caps.push('code');

    return caps;
  }

  // ─── Diagnostics ──────────────────────────────────────────────────────

  /**
   * Full system health check: LM Studio + bus + memory.
   */
  async healthCheck(): Promise<{
    lmStudio: HealthStatus;
    circuitBreaker: string;
    agents: number;
    threads: number;
    memoryEntries: number;
  }> {
    const lmStudio = await this.models.healthCheck();
    const busStats = this.bus.getStats();
    const memStats = this.memory.getStats();
    return {
      lmStudio,
      circuitBreaker: this.models.getCircuitState(),
      agents: busStats.agentCount,
      threads: busStats.threadCount,
      memoryEntries: memStats.totalEntries,
    };
  }

  getStatus(): {
    agents: AgentIdentity[];
    busStats: ReturnType<MessageBus['getStats']>;
    memoryStats: ReturnType<MemoryStore['getStats']>;
    loadedModels: string[];
  } {
    return {
      agents: this.bus.getAllAgents(),
      busStats: this.bus.getStats(),
      memoryStats: this.memory.getStats(),
      loadedModels: this.models.getLoadedModels().map(m => m.key),
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this.models.dispose();
    this.memory.dispose();
    console.log('[Orchestrator] Disposed');
  }
}
