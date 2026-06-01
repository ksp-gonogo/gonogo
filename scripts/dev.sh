#!/bin/sh
set -e

# `pnpm dev:logs` sets ENABLE_AXIOM=1 to turn on Axiom log shipping for
# this run. The tokens live in the project's existing root `.env` (which
# podman compose auto-reads anyway). When the toggle is on we source it
# explicitly so Vite sees the VITE_* keys via process.env. When the
# toggle is off we mask the tokens to empty strings — shell env beats
# compose's `.env` auto-read, so AXIOM transports stay uninstalled even
# when the file contains real tokens.
if [ "${ENABLE_AXIOM:-0}" = "1" ]; then
  if [ -f .env ]; then
    echo "[dev] ENABLE_AXIOM=1 — Axiom transports will install if tokens are set in .env"
    set -a
    . ./.env
    set +a
  else
    echo "[dev] ENABLE_AXIOM=1 set but .env is missing — running without logs" >&2
  fi
else
  export AXIOM_TOKEN=
  export AXIOM_DATASET=
  export VITE_AXIOM_TOKEN=
  export VITE_AXIOM_DATASET=
fi

# ──────────────────────────────────────────────────────────────────────
# TURN external IP for same-network stations
# ──────────────────────────────────────────────────────────────────────
# coturn (inside the relay container) advertises this address in its relay
# ICE candidates. The relay can't pick it up itself: from inside the
# container os.networkInterfaces() only sees the compose bridge IP, so it
# auto-discovers the *public* IP — which a station on the SAME WiFi can't
# reach without router hairpinning. We're on the host here, where the LAN
# IP is actually visible, so detect it and pass it through. An explicit
# TURN_EXTERNAL_IP (shell env or .env) always wins; a genuinely remote
# setup wants the public IP + port-forwarding and should set it there.
env_turn_ip=$(grep -E '^TURN_EXTERNAL_IP=.+' .env 2>/dev/null | tail -1 | cut -d= -f2-)
if [ -n "${TURN_EXTERNAL_IP:-}" ] || [ -n "$env_turn_ip" ]; then
  echo "[dev] TURN_EXTERNAL_IP override set — leaving coturn's external IP to it"
else
  lan_ip=""
  # macOS: source IP of the default-route interface.
  route_out=$(route -n get default 2>/dev/null || true)
  if [ -n "$route_out" ]; then
    def_iface=$(printf '%s\n' "$route_out" | awk '/interface:/{print $2; exit}')
    [ -n "$def_iface" ] && lan_ip=$(ipconfig getifaddr "$def_iface" 2>/dev/null || true)
  fi
  # Linux fallback: source address toward a public IP (sends no packets).
  if [ -z "$lan_ip" ] && command -v ip >/dev/null 2>&1; then
    lan_ip=$(ip route get 1.1.1.1 2>/dev/null \
      | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
  fi
  if [ -n "$lan_ip" ]; then
    export TURN_EXTERNAL_IP="$lan_ip"
    echo "[dev] TURN_EXTERNAL_IP auto-detected as $lan_ip (host LAN IP — same-WiFi stations relay through this). Set TURN_EXTERNAL_IP in .env to override for internet/remote stations."
  else
    echo "[dev] could not auto-detect a LAN IP — relay will fall back to public-IP discovery; set TURN_EXTERNAL_IP in .env if same-WiFi stations can't connect." >&2
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Build-input fingerprinting
# ──────────────────────────────────────────────────────────────────────
# Hashes everything that gets baked into a container image: the
# service's source + Dockerfile, the workspace dep we COPY in
# (@gonogo/logger), the root manifests + lockfile + tsconfig base, and
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
      echo "[$service] source changed — rebuilding container…"
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
TELNET_FP=$(compute_fingerprint telnet-proxy)
RELAY_FP=$(compute_fingerprint relay)

REBUILD=""
if [ "${BUILD:-0}" = "1" ]; then
  echo "[dev] BUILD=1 — forcing rebuild of telnet-proxy + relay"
  REBUILD="telnet-proxy relay"
else
  needs_rebuild telnet-proxy "$TELNET_FP" && REBUILD="$REBUILD telnet-proxy"
  needs_rebuild relay "$RELAY_FP" && REBUILD="$REBUILD relay"
fi

if [ -n "$REBUILD" ]; then
  echo "[dev] inputs changed since last build — rebuilding:$REBUILD"
  # shellcheck disable=SC2086 # intentional word-split: $REBUILD is a space-list
  podman compose up -d --build $REBUILD
fi
# Bring up anything else (and any service that didn't need a rebuild)
# without forcing a build context upload.
podman compose up -d

# Persist the just-built fingerprints so the *next* `pnpm dev` can
# detect what's changed since now.
printf "%s\n" "$TELNET_FP" > "$CACHE_DIR/telnet-proxy.hash"
printf "%s\n" "$RELAY_FP" > "$CACHE_DIR/relay.hash"

WATCH_PIDS=""
watch_service telnet-proxy &
WATCH_PIDS="$WATCH_PIDS $!"
watch_service relay &
WATCH_PIDS="$WATCH_PIDS $!"

turbo dev --filter='!@gonogo/telnet-proxy' --filter='!@gonogo/relay'
