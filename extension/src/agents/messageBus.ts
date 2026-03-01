/**
 * PixelClaw Agent Message Bus
 *
 * Routes messages between agents, manages conversation threads,
 * and provides pub/sub event delivery.
 *
 * Design:
 *   - In-process event bus (no external dependencies)
 *   - Messages are persisted to MemoryStore for crash recovery
 *   - Thread-safe message ordering via sequential processing
 *   - Supports broadcast, direct, and multi-target delivery
 */

import type {
  AgentIdentity,
  AgentMessage,
  AgentRole,
  AgentStatus,
  BusEvent,
  BusEventHandler,
  ConversationThread,
  MessagePayload,
  MessageType,
} from './protocol.js';

export class MessageBus {
  private agents: Map<string, AgentIdentity> = new Map();
  private threads: Map<string, ConversationThread> = new Map();
  private handlers: Set<BusEventHandler> = new Set();
  private messageQueue: AgentMessage[] = [];
  private processing = false;

  // ─── Agent Registry ─────────────────────────────────────────────────────

  registerAgent(agent: AgentIdentity): void {
    this.agents.set(agent.id, agent);
    this.emit({ type: 'agent_joined', agent });
    console.log(`[MessageBus] Agent registered: ${agent.id} (${agent.role})`);
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Remove from all active threads
    for (const thread of this.threads.values()) {
      const idx = thread.participants.indexOf(agentId);
      if (idx >= 0) thread.participants.splice(idx, 1);
    }

    this.agents.delete(agentId);
    this.emit({ type: 'agent_left', agentId });
    console.log(`[MessageBus] Agent unregistered: ${agentId}`);
  }

  getAgent(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentIdentity[] {
    return Array.from(this.agents.values());
  }

  getAgentsByRole(role: AgentRole): AgentIdentity[] {
    return this.getAllAgents().filter(a => a.role === role || a.capabilities.includes(role));
  }

  getIdleAgents(): AgentIdentity[] {
    return this.getAllAgents().filter(a => a.status === 'idle');
  }

  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.status = status;
    agent.lastActiveAt = Date.now();
    this.emit({ type: 'agent_status', agentId, status });
  }

  // ─── Message Sending ───────────────────────────────────────────────────

  /**
   * Send a message from one agent to another (or broadcast).
   * Messages are queued and processed sequentially to maintain ordering.
   */
  send(params: {
    from: string;
    to: string | string[] | null;
    type: MessageType;
    content: string;
    threadId?: string;
    payload?: MessagePayload;
    parentMessageId?: string;
    responseId?: string;
    previousResponseId?: string;
    priority?: number;
  }): AgentMessage {
    const threadId = params.threadId || this.getOrCreateThread(params.from, params.to).id;

    const message: AgentMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      threadId,
      from: params.from,
      to: params.to,
      type: params.type,
      content: params.content,
      payload: params.payload,
      timestamp: Date.now(),
      parentMessageId: params.parentMessageId,
      responseId: params.responseId,
      previousResponseId: params.previousResponseId,
      priority: params.priority ?? 5,
    };

    // Add to thread
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.messages.push(message);
      thread.updatedAt = Date.now();
    }

    // Queue for processing
    this.messageQueue.push(message);
    this.processQueue();

    return message;
  }

  /**
   * Broadcast a message to all agents.
   */
  broadcast(from: string, content: string, type: MessageType = 'broadcast'): AgentMessage {
    return this.send({ from, to: null, type, content });
  }

  /**
   * Send a task assignment from the orchestrator to the best available agent.
   */
  assignTask(params: {
    from: string;
    task: string;
    requiredCapabilities: AgentRole[];
    relevantFiles?: string[];
    timeoutMs?: number;
    priorContext?: string;
  }): { message: AgentMessage; targetAgent: AgentIdentity } | null {
    // Find best agent for the task
    const candidates = this.findBestAgent(params.requiredCapabilities);
    if (candidates.length === 0) {
      console.log(`[MessageBus] No agent available for capabilities: ${params.requiredCapabilities.join(', ')}`);
      return null;
    }

    const target = candidates[0];
    const message = this.send({
      from: params.from,
      to: target.id,
      type: 'task_assign',
      content: params.task,
      payload: {
        kind: 'task_assign',
        task: params.task,
        requiredCapabilities: params.requiredCapabilities,
        relevantFiles: params.relevantFiles,
        timeoutMs: params.timeoutMs,
        priorContext: params.priorContext,
      },
    });

    this.updateAgentStatus(target.id, 'active');
    return { message, targetAgent: target };
  }

  /**
   * Hand off a conversation from one agent to another.
   */
  handoff(params: {
    from: string;
    to: string;
    reason: string;
    conversationSummary: string;
    threadId: string;
    responseChain?: string[];
  }): AgentMessage {
    const message = this.send({
      from: params.from,
      to: params.to,
      type: 'handoff',
      content: `Handing off to ${params.to}: ${params.reason}`,
      threadId: params.threadId,
      payload: {
        kind: 'handoff',
        targetAgentId: params.to,
        reason: params.reason,
        conversationSummary: params.conversationSummary,
        responseChain: params.responseChain || [],
      },
    });

    // Add target to thread participants
    const thread = this.threads.get(params.threadId);
    if (thread && !thread.participants.includes(params.to)) {
      thread.participants.push(params.to);
    }

    return message;
  }

  // ─── Thread Management ────────────────────────────────────────────────

  createThread(title: string, participants: string[], parentThreadId?: string): ConversationThread {
    const thread: ConversationThread = {
      id: `thread_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      title,
      participants: [...participants],
      messages: [],
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentThreadId,
      responseChains: {},
    };

    this.threads.set(thread.id, thread);
    this.emit({ type: 'thread_created', thread });
    console.log(`[MessageBus] Thread created: ${thread.id} "${title}" with ${participants.length} participants`);
    return thread;
  }

  getThread(threadId: string): ConversationThread | undefined {
    return this.threads.get(threadId);
  }

  getAllThreads(): ConversationThread[] {
    return Array.from(this.threads.values());
  }

  getActiveThreads(): ConversationThread[] {
    return this.getAllThreads().filter(t => t.status === 'active');
  }

  completeThread(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    thread.status = 'completed';
    thread.updatedAt = Date.now();
    this.emit({ type: 'thread_completed', threadId });
  }

  /**
   * Get or create a thread between two parties.
   */
  private getOrCreateThread(from: string, to: string | string[] | null): ConversationThread {
    const participants = [from];
    if (typeof to === 'string') participants.push(to);
    else if (Array.isArray(to)) participants.push(...to);

    // Look for existing active thread with same participants
    for (const thread of this.threads.values()) {
      if (thread.status !== 'active') continue;
      const sortedExisting = [...thread.participants].sort();
      const sortedNew = [...new Set(participants)].sort();
      if (sortedExisting.length === sortedNew.length &&
          sortedExisting.every((p, i) => p === sortedNew[i])) {
        return thread;
      }
    }

    // Create new thread
    const title = to === null
      ? 'Broadcast'
      : `${from} ↔ ${Array.isArray(to) ? to.join(', ') : to}`;
    return this.createThread(title, [...new Set(participants)]);
  }

  /**
   * Store a response_id in the thread's response chain for an agent.
   * Used for stateful continuation within the same model.
   */
  trackResponseId(threadId: string, agentId: string, responseId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;

    if (!thread.responseChains[agentId]) {
      thread.responseChains[agentId] = [];
    }
    thread.responseChains[agentId].push(responseId);
  }

  /**
   * Get the latest response_id for an agent in a thread.
   */
  getLatestResponseId(threadId: string, agentId: string): string | undefined {
    const chain = this.threads.get(threadId)?.responseChains[agentId];
    return chain?.[chain.length - 1];
  }

  // ─── Agent Selection ──────────────────────────────────────────────────

  /**
   * Find the best available agent for a set of required capabilities.
   * Prefers: idle > active, exact role match > capability match.
   */
  findBestAgent(requiredCapabilities: AgentRole[]): AgentIdentity[] {
    const candidates: Array<{ agent: AgentIdentity; score: number }> = [];

    for (const agent of this.agents.values()) {
      if (agent.status === 'offline' || agent.status === 'error') continue;

      let score = 0;
      for (const cap of requiredCapabilities) {
        if (agent.role === cap) score += 10;          // Primary role match
        else if (agent.capabilities.includes(cap)) score += 5; // Secondary capability
      }

      if (score === 0) continue; // No capability match

      if (agent.status === 'idle') score += 20;        // Prefer idle agents
      if (agent.modelInstanceId) score += 5;           // Prefer agents with loaded models

      candidates.push({ agent, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .map(c => c.agent);
  }

  // ─── Event System ─────────────────────────────────────────────────────

  on(handler: BusEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: BusEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[MessageBus] Event handler error:`, err);
      }
    }
  }

  // ─── Queue Processing ─────────────────────────────────────────────────

  private processQueue(): void {
    if (this.processing) return;
    this.processing = true;

    while (this.messageQueue.length > 0) {
      // Sort by priority (higher first)
      this.messageQueue.sort((a, b) => b.priority - a.priority);
      const message = this.messageQueue.shift()!;
      this.deliverMessage(message);
    }

    this.processing = false;
  }

  private deliverMessage(message: AgentMessage): void {
    this.emit({ type: 'message', message });

    // Log delivery
    const toStr = message.to === null ? 'ALL' : Array.isArray(message.to) ? message.to.join(',') : message.to;
    console.log(`[MessageBus] ${message.from} → ${toStr} [${message.type}]: ${message.content.substring(0, 80)}`);
  }

  // ─── Diagnostics ──────────────────────────────────────────────────────

  getStats(): {
    agentCount: number;
    threadCount: number;
    activeThreads: number;
    totalMessages: number;
  } {
    let totalMessages = 0;
    let activeThreads = 0;
    for (const thread of this.threads.values()) {
      totalMessages += thread.messages.length;
      if (thread.status === 'active') activeThreads++;
    }
    return {
      agentCount: this.agents.size,
      threadCount: this.threads.size,
      activeThreads,
      totalMessages,
    };
  }
}
