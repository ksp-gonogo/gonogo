#!/bin/sh
set -e

# `pnpm dev:logs` sets LOGS=1 to opt into Axiom log shipping for this run.
# We source .env.logs into the parent shell so:
#   - podman compose interpolates ${AXIOM_TOKEN:-} for relay + telnet-proxy
#   - Vite picks up VITE_* keys from process.env for the browser bundle
# Without LOGS=1 (the default `pnpm dev`), the file is ignored and every
# transport stays uninstalled — same behaviour as a fresh checkout.
if [ "${LOGS:-0}" = "1" ]; then
  if [ -f .env.logs ]; then
    echo "[dev] LOGS=1 — sourcing .env.logs (Axiom transports will install)"
    set -a
    . ./.env.logs
    set +a
  else
    echo "[dev] LOGS=1 set but .env.logs is missing — running without logs" >&2
  fi
fi

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

podman compose up -d --build

WATCH_PIDS=""
watch_service telnet-proxy &
WATCH_PIDS="$WATCH_PIDS $!"
watch_service relay &
WATCH_PIDS="$WATCH_PIDS $!"

turbo dev --filter='!@gonogo/telnet-proxy' --filter='!@gonogo/relay'
