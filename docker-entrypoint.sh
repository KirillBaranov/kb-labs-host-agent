#!/bin/sh
set -e

CONFIG_FILE="/root/.kb/agent.json"
GATEWAY_URL="${GATEWAY_URL:-http://host.docker.internal:4000}"
HOST_NAME="${HOST_NAME:-workspace-agent-docker}"
CAPABILITIES="${CAPABILITIES:-filesystem,git,execution}"

# Auto-register if no credentials exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[entrypoint] No agent config found, registering with Gateway..."

  RESPONSE=$(curl -sf -X POST "${GATEWAY_URL}/hosts/register" \
    -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"${HOST_NAME}\",
      \"namespaceId\": \"default\",
      \"capabilities\": [$(echo "$CAPABILITIES" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')],
      \"workspacePaths\": [\"/workspace\"]
    }")

  HOST_ID=$(echo "$RESPONSE" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.hostId)})")
  MACHINE_TOKEN=$(echo "$RESPONSE" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.machineToken)})")

  # Get JWT credentials from token endpoint
  TOKEN_RESPONSE=$(curl -sf -X POST "${GATEWAY_URL}/auth/token" \
    -H 'Content-Type: application/json' \
    -d "{\"machineToken\": \"${MACHINE_TOKEN}\"}")

  CLIENT_ID=$(echo "$TOKEN_RESPONSE" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.clientId || '')})")
  CLIENT_SECRET=$(echo "$TOKEN_RESPONSE" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.clientSecret || '')})")

  cat > "$CONFIG_FILE" <<EOF
{
  "clientId": "${CLIENT_ID}",
  "clientSecret": "${CLIENT_SECRET}",
  "hostId": "${HOST_ID}",
  "gatewayUrl": "${GATEWAY_URL}",
  "namespaceId": "default",
  "hostType": "cloud",
  "workspacePaths": ["/workspace"],
  "execution": {
    "mode": "in-process",
    "timeoutMs": 120000
  }
}
EOF

  echo "[entrypoint] Registered as ${HOST_ID}"
else
  echo "[entrypoint] Using existing agent config"
fi

# Allow WS on Docker bridge network
export GATEWAY_ALLOW_WS=1

# Start daemon
exec node apps/host-agent-app/dist/index.js
