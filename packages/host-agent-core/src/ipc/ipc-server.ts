/**
 * IpcServer — accepts IPC requests from CLI/Studio via ILocalTransport.
 * Transport is injected — caller picks unix socket, named pipe, or TCP.
 */

import { IpcExecuteRequestSchema, IpcStatusRequestSchema } from '@kb-labs/host-agent-contracts';
import type { IpcRequest, IpcStatusResponse } from '@kb-labs/host-agent-contracts';
import type { ILocalTransport } from '@kb-labs/host-agent-transport';

export interface IpcServerOptions {
  transport: ILocalTransport;
  /** Returns current connection status */
  getStatus: () => Omit<IpcStatusResponse, 'type'>;
}

export class IpcServer {
  constructor(private readonly opts: IpcServerOptions) {}

  async start(): Promise<void> {
    this.opts.transport.onMessage((raw) => void this.handleMessage(raw));
    await this.opts.transport.listen();
  }

  stop(): void {
    this.opts.transport.close();
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const req = this.parseRequest(raw);
    if (!req) {
      console.warn('[ipc] Invalid IPC request schema:', JSON.stringify(raw).slice(0, 200));
      return;
    }

    if (req.type === 'status') {
      const status = this.opts.getStatus();
      this.opts.transport.send({ type: 'status', ...status });
      return;
    }

    // execute — wired in host-agent-app via opts.transport
    this.opts.transport.send({
      type: 'error',
      requestId: req.requestId,
      code: 'NOT_IMPLEMENTED',
      message: 'execute tunneling not yet wired',
    });
  }

  private parseRequest(raw: unknown): IpcRequest | null {
    if (typeof raw !== 'object' || raw === null || !('type' in raw)) { return null; }
    const type = (raw as Record<string, unknown>)['type'];
    if (type === 'status') { return IpcStatusRequestSchema.safeParse(raw).data ?? null; }
    if (type === 'execute') { return IpcExecuteRequestSchema.safeParse(raw).data ?? null; }
    return null;
  }
}
