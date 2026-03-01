/**
 * PixelClaw Inter-Agent Communication Protocol
 *
 * Defines the message types, agent identities, and conversation
 * threading primitives used by the agent chat system.
 *
 * Architecture:
 *   Agent → MessageBus → Router → Target Agent(s)
 *                ↕
 *          MemoryStore (persistent context)
 *                ↕
 *          ModelManager (load/unload/switch)
 */

// ─── Agent Identity ─────────────────────────────────────────────────────────

export type AgentRole = 'code' | 'reasoning' | 'vision' | 'tool_use' | 'chat' | 'evony' | 'orchestrator';

export type AgentStatus = 'idle' | 'active' | 'waiting' | 'switching_model' | 'error' | 'offline';

export interface AgentIdentity {
  /** Unique agent ID (e.g., "agent-code-1") */
  id: string;
  /** Human-readable name (e.g., "CodeBot") */
  name: string;
  /** Primary role determines default model selection */
  role: AgentRole;
  /** Secondary capabilities this agent can handle */
  capabilities: AgentRole[];
  /** Currently bound model instance ID (from LM Studio) */
  modelInstanceId: string | null;
  /** Model key from models.yaml (e.g., "Nerdsking/nerdsking-python-coder-7b-i") */
  modelKey: string | null;
  /** Current status */
  status: AgentStatus;
  /** System prompt that defines this agent's personality and instructions */
  systemPrompt: string;
  /** Last active timestamp */
  lastActiveAt: number;
  /** Conversation thread IDs this agent is participating in */
  activeThreadIds: string[];
}

// ─── Messages ───────────────────────────────────────────────────────────────

export type MessageType =
  | 'chat'           // Normal agent-to-agent message
  | 'task_assign'    // Orchestrator assigns a task
  | 'task_result'    // Agent returns task result
  | 'context_share'  // Agent shares context/knowledge
  | 'model_switch'   // Request to switch models
  | 'status_update'  // Agent status change
  | 'handoff'        // Transfer conversation to another agent
  | 'broadcast';     // Message to all agents

export interface AgentMessage {
  /** Unique message ID */
  id: string;
  /** Thread this message belongs to */
  threadId: string;
  /** Sender agent ID */
  from: string;
  /** Target agent ID(s) — null for broadcast */
  to: string | string[] | null;
  /** Message type */
  type: MessageType;
  /** Message content */
  content: string;
  /** Structured data payload (task details, context, etc.) */
  payload?: MessagePayload;
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Reference to parent message for threading */
  parentMessageId?: string;
  /** LM Studio response_id for stateful continuation (same model only) */
  responseId?: string;
  /** Previous response_id for continuing a conversation */
  previousResponseId?: string;
  /** Priority: higher = more urgent */
  priority: number;
}

// ─── Payloads ───────────────────────────────────────────────────────────────

export type MessagePayload =
  | TaskAssignPayload
  | TaskResultPayload
  | ContextSharePayload
  | ModelSwitchPayload
  | HandoffPayload;

export interface TaskAssignPayload {
  kind: 'task_assign';
  /** Task description */
  task: string;
  /** Required capabilities for this task */
  requiredCapabilities: AgentRole[];
  /** Files relevant to this task */
  relevantFiles?: string[];
  /** Deadline hint (ms) */
  timeoutMs?: number;
  /** Context from previous work */
  priorContext?: string;
}

export interface TaskResultPayload {
  kind: 'task_result';
  /** Whether the task was completed successfully */
  success: boolean;
  /** Result summary */
  summary: string;
  /** Detailed result data */
  data?: unknown;
  /** Files modified */
  modifiedFiles?: string[];
  /** Follow-up tasks suggested */
  suggestedFollowups?: string[];
}

export interface ContextSharePayload {
  kind: 'context_share';
  /** What kind of context is being shared */
  contextType: 'conversation_summary' | 'code_snippet' | 'error_log' | 'project_state' | 'decision';
  /** The context data */
  context: string;
  /** Relevant file paths */
  files?: string[];
}

export interface ModelSwitchPayload {
  kind: 'model_switch';
  /** Model to switch to */
  targetModelKey: string;
  /** Reason for the switch */
  reason: string;
  /** Context to preserve across the switch */
  preservedContext: string;
  /** Load configuration */
  loadConfig?: {
    context_length?: number;
    flash_attention?: boolean;
    num_experts?: number;
    eval_batch_size?: number;
  };
}

export interface HandoffPayload {
  kind: 'handoff';
  /** Agent to hand off to */
  targetAgentId: string;
  /** Why the handoff is happening */
  reason: string;
  /** Conversation summary for the receiving agent */
  conversationSummary: string;
  /** Response IDs from the current model's conversation (for same-model continuation) */
  responseChain: string[];
}

// ─── Conversation Threads ───────────────────────────────────────────────────

export interface ConversationThread {
  /** Unique thread ID */
  id: string;
  /** Human-readable title */
  title: string;
  /** Agent IDs participating in this thread */
  participants: string[];
  /** All messages in chronological order */
  messages: AgentMessage[];
  /** Thread status */
  status: 'active' | 'paused' | 'completed' | 'failed';
  /** Created timestamp */
  createdAt: number;
  /** Last activity timestamp */
  updatedAt: number;
  /** Parent thread (for sub-task conversations) */
  parentThreadId?: string;
  /** Model-specific response_id chains per agent (for stateful continuation) */
  responseChains: Record<string, string[]>;
}

// ─── Model State ────────────────────────────────────────────────────────────

export interface ModelState {
  /** Model key (e.g., "qwen/qwen3-coder-next") */
  key: string;
  /** LM Studio instance_id when loaded */
  instanceId: string | null;
  /** Whether this model is currently loaded in VRAM */
  isLoaded: boolean;
  /** Load configuration */
  loadConfig?: {
    context_length: number;
    flash_attention?: boolean;
    num_experts?: number;
    eval_batch_size?: number;
  };
  /** Size in GB */
  sizeGb: number;
  /** Last loaded timestamp */
  lastLoadedAt?: number;
  /** Last unloaded timestamp */
  lastUnloadedAt?: number;
  /** Agents currently using this model */
  activeAgentIds: string[];
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type BusEvent =
  | { type: 'message'; message: AgentMessage }
  | { type: 'agent_joined'; agent: AgentIdentity }
  | { type: 'agent_left'; agentId: string }
  | { type: 'agent_status'; agentId: string; status: AgentStatus }
  | { type: 'model_loaded'; modelKey: string; instanceId: string }
  | { type: 'model_unloaded'; modelKey: string }
  | { type: 'thread_created'; thread: ConversationThread }
  | { type: 'thread_completed'; threadId: string }
  | { type: 'error'; agentId: string; error: string };

export type BusEventHandler = (event: BusEvent) => void;
