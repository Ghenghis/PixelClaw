/**
 * PixelClaw Agent Chat System
 *
 * Inter-agent communication with dynamic model switching.
 *
 * Modules:
 *   protocol.ts      — Message types, agent identity, threading
 *   messageBus.ts    — Message routing and delivery
 *   modelManager.ts  — LM Studio load/unload/switch
 *   memoryStore.ts   — Persistent shared knowledge
 *   orchestrator.ts  — Top-level coordinator
 */

export * from './protocol.js';
export { MessageBus } from './messageBus.js';
export { ModelManager, type ModelManagerConfig } from './modelManager.js';
export { MemoryStore, type MemoryEntry, type MemoryStoreData } from './memoryStore.js';
export { AgentOrchestrator, type OrchestratorConfig } from './orchestrator.js';
