# ── builder ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

# coturn binary — spawned by coturnManager.ts at relay startup with a
# fresh per-restart secret. Bundling here means one container, one
# process tree, no init scripts or shared volumes for credentials.
RUN apt-get update \
  && apt-get install -y --no-install-recommends coturn ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# Proto file is loaded at runtime via @grpc/proto-loader.
COPY protos/ ./protos/

# Set at image build time by the release workflow. version.ts reads these
# as ENV first, with the runtime package.json as fallback.
ARG GONOGO_VERSION
ARG GONOGO_BUILD_TIME
ENV GONOGO_VERSION=${GONOGO_VERSION}
ENV GONOGO_BUILD_TIME=${GONOGO_BUILD_TIME}

# Relay HTTP, TURN signalling (UDP+TCP), TURN relay range. Port forwards
# on the user's home router must mirror these. See docker-compose.yml +
# the README's TURN section.
EXPOSE 3002
EXPOSE 3478/udp
EXPOSE 3478/tcp
EXPOSE 49160-49200/udp

CMD ["node", "dist/index.js"]
