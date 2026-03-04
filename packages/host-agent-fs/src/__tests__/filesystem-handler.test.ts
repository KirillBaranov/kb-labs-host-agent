import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemHandler } from '../filesystem-handler.js';
import type { CapabilityCall } from '@kb-labs/host-agent-contracts';

function call(method: string, ...args: unknown[]): CapabilityCall {
  return { requestId: 'r1', adapter: 'filesystem', method, args };
}

describe('FilesystemHandler', () => {
  let tmpDir: string;
  let handler: FilesystemHandler;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ha-fs-test-'));
    handler = new FilesystemHandler({ allowedPaths: [tmpDir] });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('reads existing file', async () => {
      await writeFile(join(tmpDir, 'hello.txt'), 'hello world', 'utf-8');
      const result = await handler.handle(call('readFile', join(tmpDir, 'hello.txt')));
      expect(result).toBe('hello world');
    });

    it('throws on file outside allowedPaths', async () => {
      await expect(handler.handle(call('readFile', '/etc/passwd'))).rejects.toThrow('Access denied');
    });
  });

  describe('writeFile', () => {
    it('writes file', async () => {
      const path = join(tmpDir, 'out.txt');
      await handler.handle(call('writeFile', path, 'content'));
      const result = await handler.handle(call('readFile', path));
      expect(result).toBe('content');
    });

    it('rejects write outside allowedPaths', async () => {
      await expect(handler.handle(call('writeFile', '/tmp/evil.txt', 'x'))).rejects.toThrow('Access denied');
    });
  });

  describe('listDir', () => {
    it('returns file names in directory', async () => {
      await writeFile(join(tmpDir, 'a.ts'), '');
      await writeFile(join(tmpDir, 'b.ts'), '');
      const result = await handler.handle(call('listDir', tmpDir)) as string[];
      expect(result).toContain('a.ts');
      expect(result).toContain('b.ts');
    });
  });

  describe('stat', () => {
    it('returns stat for existing file', async () => {
      await writeFile(join(tmpDir, 'f.txt'), '12345');
      const s = await handler.handle(call('stat', join(tmpDir, 'f.txt'))) as { size: number; isFile: boolean; isDir: boolean };
      expect(s.isFile).toBe(true);
      expect(s.isDir).toBe(false);
      expect(s.size).toBe(5);
    });

    it('returns stat for directory', async () => {
      const sub = join(tmpDir, 'sub');
      await mkdir(sub);
      const s = await handler.handle(call('stat', sub)) as { isFile: boolean; isDir: boolean };
      expect(s.isDir).toBe(true);
      expect(s.isFile).toBe(false);
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      await writeFile(join(tmpDir, 'x.txt'), '');
      expect(await handler.handle(call('exists', join(tmpDir, 'x.txt')))).toBe(true);
    });

    it('returns false for missing file', async () => {
      expect(await handler.handle(call('exists', join(tmpDir, 'nope.txt')))).toBe(false);
    });
  });

  describe('unknown method', () => {
    it('throws for unsupported method', async () => {
      await expect(handler.handle(call('deleteFile', tmpDir))).rejects.toThrow('Unknown filesystem method');
    });
  });

  describe('security', () => {
    it('rejects path with prefix bypass (no sep)', async () => {
      // /tmp/ha-fs-test-XYZ2 should not be accessible when allowedPaths = [/tmp/ha-fs-test-XYZ]
      const sibling = tmpDir + '2';
      await expect(handler.handle(call('readFile', join(sibling, 'f.txt')))).rejects.toThrow('Access denied');
    });

    it('rejects empty string arg', async () => {
      await expect(handler.handle(call('readFile', ''))).rejects.toThrow('Expected non-empty string');
    });

    it('rejects non-string arg', async () => {
      await expect(handler.handle(call('readFile', 42))).rejects.toThrow('Expected non-empty string');
    });

    it('rejects path traversal sequence', async () => {
      await expect(handler.handle(call('readFile', join(tmpDir, '..', 'etc', 'passwd')))).rejects.toThrow('Access denied');
    });
  });
});
