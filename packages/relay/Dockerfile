# Build context for this Dockerfile is the REPO ROOT, not packages/relay,
# so pnpm can resolve workspace deps (currently @gonogo/logger). The
# compose service points `context: .` + `dockerfile:
# packages/relay/Dockerfile`, and CI workflows do the same.

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

# pnpm via corepack — workspace-aware install vs npm.
RUN corepack enable

# Lockfile + workspace metadata first so the install layer caches
# until any of those change. tsconfig.base is picked up by every
# package's tsconfig via `extends`, so it has to land before the
# build step.
# Empty default so pnpm can parse .npmrc without the ${GITHUB_TOKEN}
# substitution error. relay doesn't pull from GitHub Packages.
ARG GITHUB_TOKEN=""
ENV GITHUB_TOKEN=${GITHUB_TOKEN}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/logger/package.json packages/logger/
COPY packages/relay/package.json packages/relay/

# Frozen install limited to relay + transitive workspace deps. `--filter`
# follows workspace:* edges automatically.
RUN pnpm install --frozen-lockfile --filter @gonogo/relay...

# Now bring in source. Build @gonogo/logger so its `dist/` exists, then
# build relay against it. Both packages emit Node-loadable ESM (logger
# uses NodeNext + explicit .js extensions, relay's source likewise).
COPY packages/logger/ packages/logger/
COPY packages/relay/ packages/relay/

RUN pnpm --filter @gonogo/logger build
RUN pnpm --filter @gonogo/relay build

# Deploy a self-contained app dir (workspace deps inlined into
# node_modules) for the runtime stage.
RUN pnpm --filter @gonogo/relay deploy --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

# coturn binary — spawned by coturnManager.ts at relay startup with a
# fresh per-restart secret. Bundling here means one container, one
# process tree, no init scripts or shared volumes for credentials.
RUN apt-get update \
  && apt-get install -y --no-install-recommends coturn ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

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
EXPOSE 49160-49170/udp

CMD ["node", "dist/index.js"]
