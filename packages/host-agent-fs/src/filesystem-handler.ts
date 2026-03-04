/**
 * FilesystemHandler — handles capability calls for adapter: 'filesystem'
 *
 * Supported methods:
 *   readFile(path)           → string (utf-8)
 *   writeFile(path, content) → void
 *   listDir(path)            → string[]
 *   stat(path)               → { size, isFile, isDir, mtime }
 *   exists(path)             → boolean
 *
 * Security: all paths are validated against allowedPaths allowlist.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, normalize, sep } from 'node:path';
import type { CapabilityCall } from '@kb-labs/host-agent-contracts';

export interface FilesystemHandlerOptions {
  /** Allowlisted root paths — requests outside these are rejected */
  allowedPaths: string[];
}

export class FilesystemHandler {
  constructor(private readonly opts: FilesystemHandlerOptions) {}

  async handle(call: CapabilityCall): Promise<unknown> {
    switch (call.method) {
      case 'readFile':   return this.readFile(this.argString(call.args, 0));
      case 'writeFile':  return this.writeFileMethod(this.argString(call.args, 0), this.argString(call.args, 1));
      case 'listDir':    return this.listDir(this.argString(call.args, 0));
      case 'stat':       return this.statMethod(this.argString(call.args, 0));
      case 'exists':     return this.exists(this.argString(call.args, 0));
      default:
        throw new Error(`Unknown filesystem method: ${call.method}`);
    }
  }

  private argString(args: unknown[], index: number): string {
    const val = args[index];
    if (typeof val !== 'string' || val.length === 0) {
      throw new Error(`Expected non-empty string at args[${index}]`);
    }
    return val;
  }

  private validatePath(filePath: string): string {
    const resolved = resolve(normalize(filePath));
    // Append sep to prevent partial prefix match: /home/user2 starting with /home/user
    const allowed = this.opts.allowedPaths.some((p) => {
      const base = resolve(normalize(p));
      return resolved === base || resolved.startsWith(base + sep);
    });
    if (!allowed) { throw new Error(`Access denied: ${filePath}`); }
    return resolved;
  }

  private async readFile(filePath: string): Promise<string> {
    return readFile(this.validatePath(filePath), 'utf-8');
  }

  private async writeFileMethod(filePath: string, content: string): Promise<void> {
    await writeFile(this.validatePath(filePath), content, 'utf-8');
  }

  private async listDir(dirPath: string): Promise<string[]> {
    return readdir(this.validatePath(dirPath));
  }

  private async statMethod(filePath: string): Promise<{ size: number; isFile: boolean; isDir: boolean; mtime: number }> {
    const s = await stat(this.validatePath(filePath));
    return { size: s.size, isFile: s.isFile(), isDir: s.isDirectory(), mtime: s.mtimeMs };
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await stat(this.validatePath(filePath));
      return true;
    } catch {
      return false;
    }
  }
}
