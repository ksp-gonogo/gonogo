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
