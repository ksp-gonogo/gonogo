#!/bin/sh
set -e

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
