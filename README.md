# KB Labs Host Agent

Daemon that runs on the developer's machine, connects to the cloud Gateway via authenticated WebSocket tunnel, and exposes local filesystem/git as capabilities to server-side agents.

## Architecture

```
Developer's machine:
  CLI / Studio / IDE
       │ (IPC — Unix socket ~/.kb/agent.sock)
  Host Agent daemon
       │ (WSS + JWT Bearer)
═══════════════════════════════════
  Gateway :4000  (cloud server)
       │
  REST API / Workflow / Mind
```

**Host Agent is the only process with outbound network access from the laptop.** All local file operations are performed on-machine; only results travel over the encrypted tunnel.

## Packages

| Package | Description |
|---------|-------------|
| [`@kb-labs/host-agent-contracts`](./packages/host-agent-contracts/) | Zod schemas — config, capability calls, IPC protocol |
| [`@kb-labs/host-agent-core`](./packages/host-agent-core/) | GatewayClient (WS + reconnect), IpcServer, TokenManager |
| [`@kb-labs/host-agent-fs`](./packages/host-agent-fs/) | Filesystem capability handler (read/write/list/stat) |
| [`@kb-labs/host-agent-app`](./apps/host-agent-app/) | Daemon binary — wires everything together |

## Quick Start

```bash
# 1. Register with Gateway (one-time)
# → saves ~/.kb/agent.json with clientId, clientSecret, hostId
kb agent register --gateway https://gateway.example.com

# 2. Start daemon
kb agent start

# 3. Check status
kb agent status
# → { connected: true, hostId: "host_...", gatewayUrl: "..." }

# 4. Stop daemon
kb agent stop
```

## Agent Config

Stored at `~/.kb/agent.json` after `kb agent register`:

```json
{
  "clientId": "clt_...",
  "clientSecret": "cs_...",
  "hostId": "host_...",
  "gatewayUrl": "https://gateway.example.com",
  "namespaceId": "default",
  "publicKey": "base64url-x25519-public-key"
}
```

`clientSecret` and `privateKey` never leave the machine.

## Daemon Lifecycle

```
1. Load ~/.kb/agent.json
2. POST /auth/token → { accessToken, refreshToken }
3. WSS /hosts/connect + Authorization: Bearer <accessToken>
4. → hello { protocolVersion, agentVersion, hostId }
5. ← connected { hostId, sessionId }
6. Heartbeat every 30s
7. Incoming call → dispatch to capability handler → send chunk + result
8. Token expiry (5 min before) → POST /auth/refresh → reconnect WS
9. WS disconnect → exponential backoff (1s → 2s → 4s … max 60s)
```

## Capability Handlers

### filesystem

| Method | Args | Returns |
|--------|------|---------|
| `readFile` | `path: string` | `string` (utf-8) |
| `writeFile` | `path: string, content: string` | `void` |
| `listDir` | `path: string` | `string[]` |
| `stat` | `path: string` | `{ size, isFile, isDir, mtime }` |
| `exists` | `path: string` | `boolean` |

All paths validated against `allowedPaths` allowlist — requests outside are rejected with `Access denied`.

## IPC Protocol

CLI/Studio communicates with the daemon over `~/.kb/agent.sock` (newline-delimited JSON):

```jsonc
// Status check
→ { "type": "status" }
← { "type": "status", "connected": true, "hostId": "host_...", "latencyMs": 12 }

// Execute (future — tunnels to Gateway)
→ { "type": "execute", "requestId": "...", "command": "workflow:run", "params": {...}, "stream": true }
← { "type": "event", "requestId": "...", "data": {...} }
← { "type": "done",  "requestId": "...", "result": {...} }
```

## Development

```bash
pnpm install
pnpm build

# Run daemon locally (requires ~/.kb/agent.json)
node apps/host-agent-app/dist/index.js
```
