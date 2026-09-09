# Dockerfile — build & smoke-test the opencode cache-compaction plugin in a
# clean container. Verifies the plugin loads inside a real opencode runtime and
# does not crash / run away under adversarial event streams.
#
# Build:   docker build -t cache-compaction-test .
# Run:     docker run --rm cache-compaction-test
#
# Requires Docker on the host (not available in this dev environment).

FROM oven/bun:1.4 AS build

WORKDIR /app
COPY package.json bun.lock postinstall.mjs ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# --- runtime stage: opencode + node + built plugin ---
FROM node:22-slim

# Install opencode CLI (pinned to the version used during development).
ARG OPENCODE_VERSION=1.18.29
RUN npm install -g @opencode-ai/cli@${OPENCODE_VERSION} || \
    curl -fsSL https://opencode.ai/install | bash

# Install git (needed by the HL repo layer) and set a deterministic identity so
# commits never fail on missing user.name/user.email.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system user.name "cache-compaction-test" \
    && git config --system user.email "cache-compaction-test@example.com"

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY postinstall.mjs ./
COPY scripts ./scripts

# Run the integration smoke test inside the container.
CMD ["node", "scripts/smoke-test.mjs"]
