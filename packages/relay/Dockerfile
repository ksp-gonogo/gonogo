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

EXPOSE 3002
CMD ["node", "dist/index.js"]
