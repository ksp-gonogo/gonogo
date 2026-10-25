# Build context for this Dockerfile is the REPO ROOT, not packages/relay,
# so pnpm can resolve workspace deps (currently @ksp-gonogo/logger). The
# compose service points `context: .` + `dockerfile:
# packages/relay/Dockerfile`, and CI workflows do the same.

# ── endpoint ─────────────────────────────────────────────────────────────────
# The station endpoint (Go, Pion WebRTC), built static so it runs on the
# slim Node image with no Go runtime. Go cross-compiles, so this stage runs
# on the build host's platform and targets the image's.
FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS endpoint
ARG TARGETOS
ARG TARGETARCH
WORKDIR /endpoint
COPY packages/relay/endpoint/go.mod packages/relay/endpoint/go.sum ./
RUN go mod download
COPY packages/relay/endpoint/*.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
  go build -trimpath -ldflags="-s -w" -o gonogo-endpoint .

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

# ca-certificates: TLS for the relay's public-IP discovery lookup.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
# config.ts looks for it beside dist/.
COPY --from=endpoint /endpoint/gonogo-endpoint /app/endpoint/gonogo-endpoint

# Set at image build time by the release workflow. version.ts reads these
# as ENV first, with the runtime package.json as fallback.
ARG GONOGO_VERSION
ARG GONOGO_BUILD_TIME
ENV GONOGO_VERSION=${GONOGO_VERSION}
ENV GONOGO_BUILD_TIME=${GONOGO_BUILD_TIME}

# The relay HTTP port. The station endpoint's port (47100, UDP and TCP)
# follows ENDPOINT_PORT, so it is published with -p rather than declared here;
# see docker-compose.yml and docs/NETWORKING.md.
EXPOSE 3002

CMD ["node", "dist/index.js"]
