#!/bin/sh
set -e

CONFIG_FILE="/root/.kb/agent.json"
GATEWAY_URL="${GATEWAY_URL:-http://host.docker.internal:4000}"
HOST_NAME="${HOST_NAME:-workspace-agent-docker}"
CAPABILITIES="${CAPABILITIES:-filesystem,git,execution}"

# Auto-register if no credentials exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[entrypoint] No agent config found, registering with Gateway..."

  # Build capabilities JSON array safely via Node
  CAPS_JSON=$(node -e "console.log(JSON.stringify(process.env.CAPABILITIES.split(',').map(s=>s.trim())))" 2>/dev/null)

  RESPONSE=$(curl -sf -X POST "${GATEWAY_URL}/hosts/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"${HOST_NAME}\",\"namespaceId\":\"default\",\"capabilities\":${CAPS_JSON},\"workspacePaths\":[\"/workspace\"]}")

  if [ -z "$RESPONSE" ]; then
    echo "[entrypoint] ERROR: Gateway registration failed. Is Gateway running at ${GATEWAY_URL}?"
    exit 1
  fi

  # Extract fields safely via Node (no shell interpolation of untrusted values)
  node -e "
    const reg = JSON.parse(process.argv[1]);
    if (!reg.hostId) { console.error('ERROR: No hostId in response'); process.exit(1); }
    const config = {
      hostId: reg.hostId,
      gatewayUrl: process.env.GATEWAY_URL,
      namespaceId: 'default',
      hostType: 'cloud',
      workspacePaths: ['/workspace'],
      execution: { mode: 'in-process', timeoutMs: 120000 },
    };
    require('fs').writeFileSync(process.argv[2], JSON.stringify(config, null, 2));
    require('fs').chmodSync(process.argv[2], 0o600);
    console.log('[entrypoint] Registered as ' + reg.hostId);
  " "$RESPONSE" "$CONFIG_FILE"
else
  echo "[entrypoint] Using existing agent config"
fi

# Allow WS on Docker bridge network (trusted internal network)
export GATEWAY_ALLOW_WS=1

# Start daemon
exec node apps/host-agent-app/dist/index.js
