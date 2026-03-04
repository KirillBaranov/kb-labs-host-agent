/**
 * NdjsonFramer — shared NDJSON framing logic for all transport implementations.
 *
 * Accumulates chunks, splits on newlines, emits complete JSON messages.
 * Guards against oversized buffers (DoS protection).
 */

import net from 'node:net';

const MAX_BUFFER_BYTES = 1024 * 1024; // 1 MB

export class NdjsonFramer {
  private buffer = '';

  constructor(private readonly onMessage: (msg: unknown) => void) {}

  /** Feed raw data from socket. Returns false if buffer limit exceeded. */
  feed(socket: net.Socket, chunk: Buffer | string): boolean {
    if (Buffer.byteLength(this.buffer) + Buffer.byteLength(chunk as string) > MAX_BUFFER_BYTES) {
      return false;
    }
    this.buffer += chunk.toString();

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) { continue; }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn('[transport] Malformed JSON, ignoring line');
        continue;
      }
      this.onMessage(parsed);
    }
    return true;
  }

  reset(): void {
    this.buffer = '';
  }
}

export function writeNdjson(socket: net.Socket, msg: unknown): void {
  if (!socket.destroyed) {
    socket.write(JSON.stringify(msg) + '\n');
  }
}
