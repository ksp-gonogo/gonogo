#!/bin/sh
set -e

# Parse the flags first, so a mistyped one stops here rather than after the
# relay has started. Status 10 is --help: print it and stop without error.
set +e
dev_env=$(node scripts/dev-args.mjs "$@")
dev_status=$?
set -e
case "$dev_status" in
  0) eval "$dev_env" ;;
  10) printf '%s\n' "$dev_env"; exit 0 ;;
  *) exit "$dev_status" ;;
esac

# `pnpm dev:logs` sets ENABLE_AXIOM=1 to turn on Axiom log shipping for
# this run. The tokens live in the project's existing root `.env` (which
# podman compose auto-reads anyway). When the toggle is on we source it
# explicitly so Vite sees the VITE_* keys via process.env. When the
# toggle is off we mask the tokens to empty strings, shell env beats
# compose's `.env` auto-read, so AXIOM transports stay uninstalled even
# when the file contains real tokens.
if [ "${ENABLE_AXIOM:-0}" = "1" ]; then
  if [ -f .env ]; then
    echo "[dev] ENABLE_AXIOM=1: Axiom transports will install if tokens are set in .env"
    set -a
    . ./.env
    set +a
  else
    echo "[dev] ENABLE_AXIOM=1 set but .env is missing, running without logs" >&2
  fi
else
  export AXIOM_TOKEN=
  export AXIOM_DATASET=
  export VITE_AXIOM_TOKEN=
  export VITE_AXIOM_DATASET=
fi

# ──────────────────────────────────────────────────────────────────────
# Router and LAN address for the relay
# ──────────────────────────────────────────────────────────────────────
# The station endpoint gives stations on this network this computer's LAN
# address, and the relay asks the home router to open its port. From inside
# the podman VM only the VM's own addresses are visible, so both come from the
# host's default route. An explicit ROUTER_IP or LAN_IP (shell env or .env)
# always wins.
env_router_ip=$(grep -E '^ROUTER_IP=.+' .env 2>/dev/null | tail -1 | cut -d= -f2-)
env_lan_ip=$(grep -E '^LAN_IP=.+' .env 2>/dev/null | tail -1 | cut -d= -f2-)
if [ -n "${ROUTER_IP:-}" ] || [ -n "$env_router_ip" ] || [ -n "${LAN_IP:-}" ] || [ -n "$env_lan_ip" ]; then
  echo "[dev] ROUTER_IP or LAN_IP set: using those"
else
  host_net=$(node scripts/host-network.mjs 2>/dev/null || true)
  if [ -n "$host_net" ]; then
    export ROUTER_IP="${host_net%% *}"
    export LAN_IP="${host_net##* }"
    echo "[dev] router auto-detected as $ROUTER_IP, this computer as $LAN_IP. Set ROUTER_IP and LAN_IP in .env to override."
  else
    echo "[dev] could not read the host's default route; set ROUTER_IP and LAN_IP in .env, or enter the router's address in the app's Settings, Relay." >&2
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Build-input fingerprinting
# ──────────────────────────────────────────────────────────────────────
# Hashes everything that gets baked into a container image: the
# service's source + Dockerfile, the workspace dep we COPY in
# (@ksp-gonogo/logger), the root manifests + lockfile + tsconfig base, and
# .npmrc. Stored in `.dev-build-cache/<service>.hash`; if the current
# fingerprint differs from the cached one we trigger `--build`,
# otherwise the existing image is reused.
#
# This closes the "I forgot to pass BUILD=1 after editing the
# Dockerfile / lockfile / logger package" gap. The runtime watcher
# below covers source edits during a live session; fingerprinting
# covers the between-sessions gap and the inputs the watcher doesn't
# look at. `BUILD=1` is kept as an explicit override for "I don't
# trust the cache, rebuild from scratch".
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

needs_rebuild() {
  service="$1"
  fingerprint="$2"
  cache_file="$CACHE_DIR/$service.hash"
  [ -f "$cache_file" ] || return 0
  [ "$(cat "$cache_file")" = "$fingerprint" ] && return 1
  return 0
}

watch_service() {
  service="$1"
  src_dir="packages/$service/src"
  last=$(find "$src_dir" -type f -exec cksum {} \; 2>/dev/null | sort)
  while true; do
    sleep 2
    current=$(find "$src_dir" -type f -exec cksum {} \; 2>/dev/null | sort)
    if [ "$current" != "$last" ]; then
      last="$current"
      echo "[$service] source changed: rebuilding container..."
      podman compose up -d --build "$service"
      compute_fingerprint "$service" > "$CACHE_DIR/$service.hash"
    fi
  done
}

cleanup() {
  for pid in $WATCH_PIDS; do
    kill "$pid" 2>/dev/null
  done
  podman compose down
}
trap cleanup EXIT

# BuildKit + classic-builder bypass. No-op when the underlying daemon is
# podman (which uses buildah), but on a Docker daemon this skips the
# full-context upload on cache hits. Harmless either way.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Compute fingerprints up front so we can both decide what to rebuild
# *and* persist the post-build state without recomputing.
RELAY_FP=$(compute_fingerprint relay)

REBUILD=""
if [ "${BUILD:-0}" = "1" ]; then
  echo "[dev] BUILD=1: forcing rebuild of relay"
  REBUILD="relay"
else
  needs_rebuild relay "$RELAY_FP" && REBUILD="$REBUILD relay"
fi

if [ -n "$REBUILD" ]; then
  echo "[dev] inputs changed since last build, rebuilding:$REBUILD"
  # shellcheck disable=SC2086 # intentional word-split: $REBUILD is a space-list
  podman compose up -d --build $REBUILD
fi
# Bring up anything else (and any service that didn't need a rebuild)
# without forcing a build context upload.
podman compose up -d

# Persist the just-built fingerprint so the *next* `pnpm dev` can
# detect what's changed since now.
printf "%s\n" "$RELAY_FP" > "$CACHE_DIR/relay.hash"

WATCH_PIDS=""
watch_service relay &
WATCH_PIDS="$WATCH_PIDS $!"

# Concurrency must exceed the number of persistent dev tasks (one per package
# with a `dev` script). Turbo's default of 10 is now below the package count,
# so set headroom explicitly or `turbo dev` refuses to start.
turbo dev --filter='!@ksp-gonogo/relay' --concurrency=16
