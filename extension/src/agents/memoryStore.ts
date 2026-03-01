/**
 * PixelClaw Agent Memory Store
 *
 * Persistent shared memory for agent knowledge exchange.
 * Stores conversation summaries, project state, and agent knowledge
 * to enable seamless context preservation across model switches.
 *
 * Storage: JSON file in the workspace .pixelclaw/ directory.
 * Designed for crash recovery — all writes are atomic.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentMessage, ConversationThread } from './protocol.js';

export interface MemoryEntry {
  /** Unique entry ID */
  id: string;
  /** Entry type */
  type: 'conversation_summary' | 'project_state' | 'agent_knowledge' | 'task_result' | 'decision';
  /** Agent that created this entry */
  agentId: string;
  /** Thread this entry belongs to (if any) */
  threadId?: string;
  /** Content of the memory */
  content: string;
  /** Tags for retrieval */
  tags: string[];
  /** Relevant files */
  files?: string[];
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
  /** TTL in milliseconds — entry expires after this duration (0 = never) */
  ttlMs: number;
}

export interface MemoryStoreData {
  version: number;
  entries: MemoryEntry[];
  /** Model response_id chains — keyed by "threadId:agentId" */
  responseChains: Record<string, string[]>;
  /** Last compaction timestamp */
  lastCompactedAt: number;
}

const STORE_VERSION = 1;
const DEFAULT_STORE: MemoryStoreData = {
  version: STORE_VERSION,
  entries: [],
  responseChains: {},
  lastCompactedAt: Date.now(),
};

export class MemoryStore {
  private data: MemoryStoreData;
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceDir: string) {
    const storeDir = path.join(workspaceDir, '.pixelclaw');
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    this.filePath = path.join(storeDir, 'agent-memory.json');
    this.data = this.load();
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private load(): MemoryStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as MemoryStoreData;
        if (parsed.version === STORE_VERSION) {
          return parsed;
        }
        console.log(`[MemoryStore] Version mismatch (${parsed.version} vs ${STORE_VERSION}), starting fresh`);
      }
    } catch (err) {
      console.error(`[MemoryStore] Failed to load:`, err);
    }
    return { ...DEFAULT_STORE };
  }

  /**
   * Save to disk. Uses atomic write (write to temp, then rename).
   */
  save(): void {
    try {
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(`[MemoryStore] Failed to save:`, err);
    }
  }

  /**
   * Schedule a debounced save (coalesces rapid writes).
   */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, 1000);
  }

  // ─── Memory Entries ───────────────────────────────────────────────────

  /**
   * Store a new memory entry.
   */
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry {
    const full: MemoryEntry = {
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.data.entries.push(full);
    this.scheduleSave();
    console.log(`[MemoryStore] Stored: ${full.id} [${full.type}] by ${full.agentId}`);
    return full;
  }

  /**
   * Update an existing memory entry.
   */
  update(id: string, updates: Partial<Pick<MemoryEntry, 'content' | 'tags' | 'files'>>): MemoryEntry | null {
    const entry = this.data.entries.find(e => e.id === id);
    if (!entry) return null;

    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.files !== undefined) entry.files = updates.files;
    entry.updatedAt = Date.now();

    this.scheduleSave();
    return entry;
  }

  /**
   * Get a memory entry by ID.
   */
  get(id: string): MemoryEntry | null {
    return this.data.entries.find(e => e.id === id) || null;
  }

  /**
   * Search entries by tags, type, or agent.
   */
  search(params: {
    tags?: string[];
    type?: MemoryEntry['type'];
    agentId?: string;
    threadId?: string;
    limit?: number;
  }): MemoryEntry[] {
    let results = this.data.entries;

    // Filter expired entries
    const now = Date.now();
    results = results.filter(e => e.ttlMs === 0 || (e.createdAt + e.ttlMs) > now);

    if (params.type) {
      results = results.filter(e => e.type === params.type);
    }

    if (params.agentId) {
      results = results.filter(e => e.agentId === params.agentId);
    }

    if (params.threadId) {
      results = results.filter(e => e.threadId === params.threadId);
    }

    if (params.tags && params.tags.length > 0) {
      results = results.filter(e => params.tags!.some(t => e.tags.includes(t)));
    }

    // Sort by most recent
    results.sort((a, b) => b.updatedAt - a.updatedAt);

    if (params.limit) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  /**
   * Delete a memory entry.
   */
  delete(id: string): boolean {
    const idx = this.data.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    this.data.entries.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  // ─── Conversation Context ─────────────────────────────────────────────

  /**
   * Store a conversation summary for seamless model switching.
   * Called before switching models to preserve context.
   */
  storeConversationSummary(params: {
    agentId: string;
    threadId: string;
    summary: string;
    modelKey: string;
    responseChain: string[];
  }): MemoryEntry {
    // Store the response chain
    const chainKey = `${params.threadId}:${params.agentId}`;
    this.data.responseChains[chainKey] = params.responseChain;

    return this.store({
      type: 'conversation_summary',
      agentId: params.agentId,
      threadId: params.threadId,
      content: params.summary,
      tags: ['conversation', 'model_switch', params.modelKey],
      ttlMs: 0, // Never expires
    });
  }

  /**
   * Retrieve conversation context for an agent in a thread.
   * Used after model switch to replay context.
   */
  getConversationContext(threadId: string, agentId: string, maxEntries = 5): {
    summaries: MemoryEntry[];
    responseChain: string[];
  } {
    const summaries = this.search({
      type: 'conversation_summary',
      agentId,
      threadId,
      limit: maxEntries,
    });

    const chainKey = `${threadId}:${agentId}`;
    const responseChain = this.data.responseChains[chainKey] || [];

    return { summaries, responseChain };
  }

  /**
   * Build a context replay prompt from stored conversation summaries.
   * This is injected as system_prompt when switching models.
   */
  buildContextReplay(threadId: string, agentId: string): string {
    const { summaries } = this.getConversationContext(threadId, agentId);

    if (summaries.length === 0) return '';

    const parts = [
      '=== CONVERSATION CONTEXT (preserved across model switch) ===',
      '',
    ];

    for (const s of summaries.reverse()) {
      const when = new Date(s.createdAt).toISOString();
      parts.push(`[${when}] ${s.content}`);
    }

    parts.push('', '=== END CONTEXT ===');
    return parts.join('\n');
  }

  // ─── Task Results ─────────────────────────────────────────────────────

  /**
   * Store the result of a completed task.
   */
  storeTaskResult(params: {
    agentId: string;
    threadId: string;
    task: string;
    result: string;
    success: boolean;
    files?: string[];
  }): MemoryEntry {
    return this.store({
      type: 'task_result',
      agentId: params.agentId,
      threadId: params.threadId,
      content: `Task: ${params.task}\nSuccess: ${params.success}\nResult: ${params.result}`,
      tags: ['task', params.success ? 'success' : 'failure'],
      files: params.files,
      ttlMs: 0,
    });
  }

  // ─── Project State ────────────────────────────────────────────────────

  /**
   * Store or update project-level state that all agents should know about.
   */
  storeProjectState(agentId: string, key: string, value: string): MemoryEntry {
    // Check for existing entry with same key
    const existing = this.data.entries.find(
      e => e.type === 'project_state' && e.tags.includes(`state:${key}`)
    );

    if (existing) {
      existing.content = value;
      existing.updatedAt = Date.now();
      this.scheduleSave();
      return existing;
    }

    return this.store({
      type: 'project_state',
      agentId,
      content: value,
      tags: ['project', `state:${key}`],
      ttlMs: 0,
    });
  }

  /**
   * Get a project state value by key.
   */
  getProjectState(key: string): string | null {
    const entry = this.data.entries.find(
      e => e.type === 'project_state' && e.tags.includes(`state:${key}`)
    );
    return entry?.content || null;
  }

  // ─── Compaction ───────────────────────────────────────────────────────

  /**
   * Remove expired entries and old conversation summaries.
   */
  compact(): number {
    const now = Date.now();
    const before = this.data.entries.length;

    this.data.entries = this.data.entries.filter(e => {
      if (e.ttlMs > 0 && (e.createdAt + e.ttlMs) < now) return false;
      return true;
    });

    this.data.lastCompactedAt = now;
    const removed = before - this.data.entries.length;

    if (removed > 0) {
      this.scheduleSave();
      console.log(`[MemoryStore] Compacted: removed ${removed} expired entries`);
    }

    return removed;
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  getStats(): {
    totalEntries: number;
    byType: Record<string, number>;
    responseChains: number;
    fileSizeBytes: number;
  } {
    const byType: Record<string, number> = {};
    for (const e of this.data.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    let fileSizeBytes = 0;
    try {
      if (fs.existsSync(this.filePath)) {
        fileSizeBytes = fs.statSync(this.filePath).size;
      }
    } catch { /* ignore */ }

    return {
      totalEntries: this.data.entries.length,
      byType,
      responseChains: Object.keys(this.data.responseChains).length,
      fileSizeBytes,
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.save();
  }
}
