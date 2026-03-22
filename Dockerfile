# Workspace Agent — Docker image
# Connects to Gateway and accepts remote plugin execution.
#
# Build:
#   docker build -t kb-workspace-agent .
#
# Run:
#   docker run -e GATEWAY_URL=http://host.docker.internal:4000 kb-workspace-agent

FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace-level package files for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/ apps/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile --prod

# Build all packages
RUN pnpm run build

# ── Production image ──
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

# Agent config directory
RUN mkdir -p /root/.kb

ENV NODE_ENV=production
ENV GATEWAY_URL=http://host.docker.internal:4000
ENV HOST_NAME=workspace-agent-docker

ENTRYPOINT ["/docker-entrypoint.sh"]
