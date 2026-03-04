/**
 * GatewayClient — WebSocket connection to Gateway with:
 * - JWT Bearer auth
 * - hello/connected handshake
 * - heartbeat every 30s
 * - exponential backoff reconnect (1s → 2s → 4s … max 60s)
 * - dispatches incoming `call` messages to registered capability handlers
 */

import WebSocket from 'ws';
import type { CapabilityCall } from '@kb-labs/host-agent-contracts';

export type CallHandler = (call: CapabilityCall) => Promise<unknown>;

export interface GatewayClientOptions {
  /** wss://gateway.example.com */
  gatewayUrl: string;
  agentVersion: string;
  /** Returns current valid access token */
  getAccessToken: () => string;
  /** Called when connection is established and handshake complete */
  onConnected?: (hostId: string, sessionId: string) => void;
  /** Called when disconnected */
  onDisconnected?: () => void;
  /** Called when token needs refresh (triggered before reconnect) */
  onTokenExpired?: () => Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HELLO_TIMEOUT_MS = 5_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = BACKOFF_INITIAL_MS;
  private stopped = false;
  private hostId: string | null = null;
  private pendingCalls = new Map<string, (result: unknown) => void>();
  private handlers = new Map<string, CallHandler>();

  constructor(private readonly opts: GatewayClientOptions) {}

  /** Register a handler for calls to a specific adapter */
  registerHandler(adapter: string, handler: CallHandler): void {
    this.handlers.set(adapter, handler);
  }

  async connect(): Promise<void> {
    this.stopped = false;
    await this.doConnect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, 'agent stopped');
    this.ws = null;
  }

  private async doConnect(): Promise<void> {
    const token = this.opts.getAccessToken();
    const wsUrl = this.opts.gatewayUrl.replace(/^http/, 'ws') + '/hosts/connect';

    if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://localhost') && !wsUrl.startsWith('ws://127.0.0.1')) {
      throw new Error(`GatewayClient: insecure WebSocket URL rejected — must use wss:// (got ${wsUrl})`);
    }

    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data.toString()));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => { console.warn('[gateway-client] WS error:', err.message); });
  }

  private onOpen(): void {
    this.send({
      type: 'hello',
      protocolVersion: '1.0',
      agentVersion: this.opts.agentVersion,
      hostId: this.hostId ?? undefined,
    });

    // Timeout if no 'connected' reply
    const helloTimeout = setTimeout(() => {
      this.ws?.close(1008, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    this.ws!.once('message', (data) => {
      clearTimeout(helloTimeout);
      let msg: { type: string; hostId?: string; sessionId?: string };
      try {
        msg = JSON.parse(data.toString()) as { type: string; hostId?: string; sessionId?: string };
      } catch {
        this.ws?.close(1008, 'malformed handshake message');
        return;
      }
      if (msg.type === 'connected' && msg.hostId && typeof msg.hostId === 'string') {
        this.hostId = msg.hostId;
        this.backoffMs = BACKOFF_INITIAL_MS; // reset on success
        this.startHeartbeat();
        this.opts.onConnected?.(msg.hostId, msg.sessionId ?? '');
      } else {
        this.ws?.close(1008, 'unexpected message during handshake');
      }
    });
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg['type'] === 'call') {
      void this.handleCall(msg as unknown as CapabilityCall);
    }
    // heartbeat ack — no action needed
  }

  private async handleCall(call: CapabilityCall): Promise<void> {
    const handler = this.handlers.get(call.adapter);
    if (!handler) {
      this.send({
        type: 'error',
        requestId: call.requestId,
        error: { code: 'UNKNOWN_ADAPTER', message: `No handler for adapter: ${call.adapter}`, retryable: false },
      });
      return;
    }

    try {
      const result = await handler(call);
      this.send({ type: 'chunk', requestId: call.requestId, data: result, index: 0 });
      this.send({ type: 'result', requestId: call.requestId, done: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'error',
        requestId: call.requestId,
        error: { code: 'HANDLER_ERROR', message, retryable: false },
      });
    }
  }

  private onClose(): void {
    this.clearTimers();
    this.opts.onDisconnected?.();
    if (!this.stopped) {this.scheduleReconnect();}
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      if (this.stopped) {return;}
      await this.opts.onTokenExpired?.();
      await this.doConnect();
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    }, this.backoffMs);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
