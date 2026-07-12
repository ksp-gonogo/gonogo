# Build context for this Dockerfile is the REPO ROOT, not packages/telnet-proxy,
# so pnpm can resolve workspace deps (currently @ksp-gonogo/logger). The
# compose service points `context: .` + `dockerfile:
# packages/telnet-proxy/Dockerfile`, and CI workflows do the same.

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /repo

# Build tools required to compile node-pty native bindings from source.
# (Alpine uses musl libc so prebuilt binaries are often unavailable.)
RUN apk add --no-cache python3 make g++

# pnpm via corepack — workspace-aware install vs npm.
RUN corepack enable

# Lockfile + workspace metadata first so the install layer caches
# until any of those change. tsconfig.base is picked up by every
# package's tsconfig via `extends`; .npmrc carries the
# `inject-workspace-packages=true` setting that `pnpm deploy` needs.
# Empty default so pnpm can parse .npmrc without the ${GITHUB_TOKEN}
# substitution error. telnet-proxy doesn't pull from GitHub Packages.
ARG GITHUB_TOKEN=""
ENV GITHUB_TOKEN=${GITHUB_TOKEN}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/logger/package.json packages/logger/
COPY packages/telnet-proxy/package.json packages/telnet-proxy/

# Frozen install limited to telnet-proxy + transitive workspace deps.
# `--filter` follows workspace:* edges automatically.
RUN pnpm install --frozen-lockfile --filter @ksp-gonogo/telnet-proxy...

# Now bring in source. Build @ksp-gonogo/logger first so its `dist/` exists,
# then build telnet-proxy against it. Both packages emit Node-loadable
# ESM (logger uses NodeNext + explicit .js extensions).
COPY packages/logger/ packages/logger/
COPY packages/telnet-proxy/ packages/telnet-proxy/

RUN pnpm --filter @ksp-gonogo/logger build
RUN pnpm --filter @ksp-gonogo/telnet-proxy build

# Deploy a self-contained app dir (workspace deps inlined into
# node_modules) for the runtime stage.
RUN pnpm --filter @ksp-gonogo/telnet-proxy deploy --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

# telnet client — the PTY spawns `telnet host port`, so it must be in PATH.
# busybox-extras ships a telnet binary on Alpine.
RUN apk add --no-cache busybox-extras

COPY --from=builder /app /app

# Set at image build time by the release workflow. version.ts reads these
# as ENV first, with the runtime package.json as fallback.
ARG GONOGO_VERSION
ARG GONOGO_BUILD_TIME
ENV GONOGO_VERSION=${GONOGO_VERSION}
ENV GONOGO_BUILD_TIME=${GONOGO_BUILD_TIME}

EXPOSE 3001
CMD ["node", "dist/index.js"]
