import { describe, it, expect, vi } from 'vitest';
import { ExecutionHandler } from '../handlers/execution-handler.js';

function makeHandler() {
  return new ExecutionHandler({
    workspacePaths: ['/tmp/test-workspace'],
    gatewayTransport: { send: vi.fn(), close: vi.fn() } as any,
    executionMode: 'in-process',
    timeoutMs: 5000,
  });
}

describe('ExecutionHandler — descriptor validation', () => {
  it('rejects execution when descriptor.permissions is missing', async () => {
    const handler = makeHandler();

    const result = handler.handle({
      type: 'call',
      requestId: 'req-1',
      adapter: 'execution',
      method: 'execute',
      args: [{
        executionId: 'exec-no-perms',
        pluginId: '@test/plugin',
        handlerRef: 'dist/handler.js',
        input: {},
        descriptor: {
          pluginId: '@test/plugin',
          pluginVersion: '1.0.0',
          handlerId: 'handler',
          requestId: 'req-1',
          hostType: 'cli',
          hostContext: { host: 'cli' },
          // NO permissions field
        },
      }],
    });

    await expect(result).rejects.toThrow('descriptor.permissions is required');
  });

  it('rejects execution when descriptor is missing entirely', async () => {
    const handler = makeHandler();

    const result = handler.handle({
      type: 'call',
      requestId: 'req-2',
      adapter: 'execution',
      method: 'execute',
      args: [{
        executionId: 'exec-no-desc',
        pluginId: '@test/plugin',
        handlerRef: 'dist/handler.js',
        input: {},
        // NO descriptor
      }],
    });

    await expect(result).rejects.toThrow('descriptor.permissions is required');
  });
});
