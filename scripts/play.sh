#!/bin/sh
set -e

# `pnpm play` brings up the same proxy + relay containers as `pnpm dev`
# but serves the production-built SPA via `vite preview` instead of the
# Vite dev server. No HMR, no source watchers — meant for actually
# playing rather than coding. The browser hits `http://localhost:4173`
# (Vite preview's default port).
#
# `pnpm play:logs` adds Axiom log shipping for the run, same toggle as
# `dev:logs`. The build picks up `VITE_AXIOM_*` from process.env at
# build time (Vite embeds them statically), so the toggle has to gate
# *both* the build inputs and the runtime container env. The
# fingerprint below already includes the AXIOM env keys for that
# reason.

# ──────────────────────────────────────────────────────────────────────
# Axiom toggle — same shape as scripts/dev.sh
# ──────────────────────────────────────────────────────────────────────
if [ "${ENABLE_AXIOM:-0}" = "1" ]; then
  if [ -f .env ]; then
    echo "[play] ENABLE_AXIOM=1 — Axiom transports will install if tokens are set in .env"
    set -a
    . ./.env
    set +a
  else
    echo "[play] ENABLE_AXIOM=1 set but .env is missing — running without logs" >&2
  fi
else
  export AXIOM_TOKEN=
  export AXIOM_DATASET=
  export VITE_AXIOM_TOKEN=
  export VITE_AXIOM_DATASET=
fi

# ──────────────────────────────────────────────────────────────────────
# Fingerprint cache — same convention as scripts/dev.sh, plus an `app`
# entry so a stale dist/ doesn't get reused after a code change. Vite
# embeds VITE_* env vars at build time, so the fingerprint also folds
# in the AXIOM tokens — toggling the logs flag triggers a fresh build
# even if no source changed.
# ──────────────────────────────────────────────────────────────────────
CACHE_DIR=".dev-build-cache"
mkdir -p "$CACHE_DIR"

compute_fingerprint() {
  service="$1"
  {
    find "packages/$service" "packages/logger" -type f \
      -not -path '*/node_modules/*' \
      -not -path '*/dist/*' \
      -not -path '*/.turbo/*' \
      -not -name '*.tsbuildinfo' \
      -exec sh -c 'printf "%s\n" "$1"; cat "$1"' _ {} \; 2>/dev/null
    for f in package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc; do
      if [ -f "$f" ]; then
        printf "%s\n" "$f"
        cat "$f"
      fi
    done
  } | sha256sum | awk '{print $1}'
}

compute_app_fingerprint() {
  {
    # Every workspace package the app bundle pulls in. We hash all
    # workspace src trees rather than try to enumerate the dependency
    # graph — false-positive rebuilds are cheap; missed rebuilds
    # produce mystery-stale bundles.
    find packages -type f \
      -not -path '*/node_modules/*' \
      -not -path '*/dist/*' \
      -not -path '*/.turbo/*' \
      -not -name '*.tsbuildinfo' \
      -exec sh -c 'printf "%s\n" "$1"; cat "$1"' _ {} \; 2>/dev/null
    for f in package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc; do
      if [ -f "$f" ]; then
        printf "%s\n" "$f"
        cat "$f"
      fi
    done
    # Vite bakes VITE_* env vars into the bundle at build time, so
    # toggling ENABLE_AXIOM (or rotating the token) needs to invalidate
    # the cache even when no source changed.
    printf "VITE_AXIOM_TOKEN=%s\n" "${VITE_AXIOM_TOKEN:-}"
    printf "VITE_AXIOM_DATASET=%s\n" "${VITE_AXIOM_DATASET:-}"
    printf "VITE_AXIOM_URL=%s\n" "${VITE_AXIOM_URL:-}"
    printf "VITE_AXIOM_ORG_ID=%s\n" "${VITE_AXIOM_ORG_ID:-}"
  } | sha256sum | awk '{print $1}'
}

needs_rebuild() {
  cache_file="$CACHE_DIR/$1.hash"
  [ -f "$cache_file" ] || return 0
  [ "$(cat "$cache_file")" = "$2" ] && return 1
  return 0
}

cleanup() {
  podman compose down
}
trap cleanup EXIT

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# ──────────────────────────────────────────────────────────────────────
# Containers — same fingerprint logic as dev.sh
# ──────────────────────────────────────────────────────────────────────
TELNET_FP=$(compute_fingerprint telnet-proxy)
RELAY_FP=$(compute_fingerprint relay)

REBUILD=""
if [ "${BUILD:-0}" = "1" ]; then
  echo "[play] BUILD=1 — forcing rebuild of telnet-proxy + relay"
  REBUILD="telnet-proxy relay"
else
  needs_rebuild telnet-proxy "$TELNET_FP" && REBUILD="$REBUILD telnet-proxy"
  needs_rebuild relay "$RELAY_FP" && REBUILD="$REBUILD relay"
fi

if [ -n "$REBUILD" ]; then
  echo "[play] container inputs changed — rebuilding:$REBUILD"
  # shellcheck disable=SC2086 # intentional word-split: $REBUILD is a space-list
  podman compose up -d --build $REBUILD
fi
podman compose up -d

printf "%s\n" "$TELNET_FP" > "$CACHE_DIR/telnet-proxy.hash"
printf "%s\n" "$RELAY_FP" > "$CACHE_DIR/relay.hash"

# ──────────────────────────────────────────────────────────────────────
# App build (skip if fingerprint matches)
# ──────────────────────────────────────────────────────────────────────
APP_FP=$(compute_app_fingerprint)
if [ "${BUILD:-0}" = "1" ] || needs_rebuild app "$APP_FP" || [ ! -d packages/app/dist ]; then
  echo "[play] building @gonogo/app for production"
  pnpm --filter @gonogo/app build
  printf "%s\n" "$APP_FP" > "$CACHE_DIR/app.hash"
else
  echo "[play] app bundle is up-to-date — serving existing dist/"
fi

# ──────────────────────────────────────────────────────────────────────
# Serve via vite preview. Foregrounded so Ctrl+C tears down the
# containers via the trap above.
# ──────────────────────────────────────────────────────────────────────
pnpm --filter @gonogo/app exec vite preview
