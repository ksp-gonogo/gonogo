# Build context for this Dockerfile is the REPO ROOT, not packages/relay,
# so pnpm can resolve workspace deps (currently @ksp-gonogo/logger). The
# compose service points `context: .` + `dockerfile:
# packages/relay/Dockerfile`, and CI workflows do the same.

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

# pnpm via corepack: workspace-aware install vs npm.
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
RUN pnpm install --frozen-lockfile --filter @ksp-gonogo/relay...

# Now bring in source. Build @ksp-gonogo/logger so its `dist/` exists, then
# build relay against it. Both packages emit Node-loadable ESM (logger
# uses NodeNext + explicit .js extensions, relay's source likewise).
COPY packages/logger/ packages/logger/
COPY packages/relay/ packages/relay/
# Both builds end in ../../scripts/prune-dist.mjs.
COPY scripts/ scripts/

RUN pnpm --filter @ksp-gonogo/logger build
RUN pnpm --filter @ksp-gonogo/relay build

# Deploy a self-contained app dir (workspace deps inlined into
# node_modules) for the runtime stage.
RUN pnpm --filter @ksp-gonogo/relay deploy --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

# coturn binary: spawned by coturnManager.ts at relay startup with a
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

# The relay HTTP port. The TURN ports (3478 for signalling over UDP and TCP,
# 49160-49170/udp for relay sessions by default) follow TURN_PORT, TURN_MIN_PORT
# and TURN_MAX_PORT, so they are published with -p rather than declared here;
# see docker-compose.yml and docs/NETWORKING.md.
EXPOSE 3002

CMD ["node", "dist/index.js"]
