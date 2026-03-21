/**
 * ExecutionHandler — capability handler for plugin execution on Workspace Agent.
 *
 * Receives ExecutionRequest from Platform (via Gateway WS call),
 * executes plugin handler locally using plugin-runtime with proxy platform.
 *
 * Flow:
 *   Platform → Gateway → WS call(adapter:'execution', method:'execute')
 *   → ExecutionHandler.handle()
 *   → LocalPluginResolver.resolve(pluginId) → local path
 *   → createProxyPlatform(GatewayTransport) → proxy LLM/cache/etc
 *   → runInProcess(descriptor, proxyPlatform, handlerPath, input)
 *   → plugin handler executes (npm packages work natively)
 *   → result → WS response → Gateway → Platform
 *
 * Security:
 * - Paths validated via LocalPluginResolver (no traversal, no escape)
 * - Plugin allowlist enforcement
 * - Execution journal for idempotency (at-most-once)
 * - Timeout via AbortSignal
 *
 * @see ADR-0017: Workspace Agent Architecture
 * @see ADR-0053: Delivery Semantics
 */

import { resolve } from 'node:path';
import type { CapabilityCall } from '@kb-labs/host-agent-contracts';
import type { GatewayTransport } from '@kb-labs/host-agent-core';
import { createProxyPlatform } from '@kb-labs/core-runtime';
import { runInProcess } from '@kb-labs/plugin-runtime';
import { noopUI } from '@kb-labs/plugin-contracts';
import type { PluginContextDescriptor } from '@kb-labs/plugin-contracts';
import { LocalPluginResolver, type PluginInventoryEntry } from './local-plugin-resolver.js';

// ── Types ──

interface ExecutionRequest {
  executionId: string;
  pluginId: string;
  handlerRef: string;
  exportName?: string;
  input: unknown;
  descriptor: PluginContextDescriptor;
  timeoutMs?: number;
}

interface JournalEntry {
  status: 'started' | 'completed';
  result?: unknown;
  error?: string;
  startedAt: number;
}

export interface ExecutionHandlerOptions {
  gatewayTransport: GatewayTransport;
  allowedPaths: string[];
  executionMode: 'in-process' | 'subprocess';
  timeoutMs: number;
  allowedPlugins?: string[];
}

// ── Constants ──

const JOURNAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Handler ──

export class ExecutionHandler {
  private pluginResolver: LocalPluginResolver;
  private journal = new Map<string, JournalEntry>();
  private journalCleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly opts: ExecutionHandlerOptions) {
    this.pluginResolver = new LocalPluginResolver(opts.allowedPaths);

    // Periodic journal cleanup
    this.journalCleanupTimer = setInterval(() => this.cleanupJournal(), JOURNAL_TTL_MS);
  }

  /** Stop background tasks */
  stop(): void {
    clearInterval(this.journalCleanupTimer);
  }

  /** Capability call dispatcher */
  async handle(call: CapabilityCall): Promise<unknown> {
    switch (call.method) {
      case 'execute':
        return this.execute(call.args[0] as ExecutionRequest);
      case 'discover':
        return this.discover();
      default:
        throw new Error(`Unknown execution method: ${call.method}`);
    }
  }

  /** Return plugin inventory */
  private async discover(): Promise<PluginInventoryEntry[]> {
    return this.pluginResolver.listPlugins();
  }

  /** Execute a plugin handler locally */
  private async execute(request: ExecutionRequest): Promise<unknown> {
    const { executionId, pluginId, handlerRef, input, descriptor, timeoutMs } = request;

    // 1. Idempotency check (at-most-once for mutating, ADR-0053)
    const existing = this.journal.get(executionId);
    if (existing) {
      if (existing.status === 'completed') {
        if (existing.error) {
          throw new Error(existing.error);
        }
        return existing.result;
      }
      throw new Error(`Execution ${executionId} already in progress`);
    }
    this.journal.set(executionId, { status: 'started', startedAt: Date.now() });

    // 2. Plugin allowlist check
    if (this.opts.allowedPlugins && this.opts.allowedPlugins.length > 0) {
      if (!this.opts.allowedPlugins.includes(pluginId)) {
        this.journal.delete(executionId);
        throw new Error(`Plugin not allowed: ${pluginId}`);
      }
    }

    // 3. Resolve plugin locally (Workspace Agent owns path resolution)
    const resolved = await this.pluginResolver.resolve(pluginId, handlerRef);

    // 4. Create proxy platform (LLM/Cache/etc → GatewayTransport → Platform)
    const proxyPlatform = await createProxyPlatform({
      transport: this.opts.gatewayTransport as any,
    });

    // 5. Setup timeout
    const effectiveTimeout = timeoutMs ?? this.opts.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      // 6. Execute plugin handler locally
      const result = await runInProcess({
        descriptor,
        platform: proxyPlatform as any,
        ui: noopUI,
        handlerPath: resolved.handlerPath,
        input,
        signal: controller.signal,
        cwd: resolved.pluginRoot,
      });

      // 7. Record success in journal
      this.journal.set(executionId, {
        status: 'completed',
        result: result.data,
        startedAt: this.journal.get(executionId)!.startedAt,
      });

      return result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Record error in journal
      this.journal.set(executionId, {
        status: 'completed',
        error: message,
        startedAt: this.journal.get(executionId)!.startedAt,
      });

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Remove expired journal entries */
  private cleanupJournal(): void {
    const now = Date.now();
    for (const [id, entry] of this.journal) {
      if (entry.status === 'completed' && now - entry.startedAt > JOURNAL_TTL_MS) {
        this.journal.delete(id);
      }
    }
  }
}
