#!/bin/bash
# Supervisor for the gonogo bundle image. Runs two long-lived processes:
#   1. static server  — the app SPA on $APP_PORT (history-fallback for /station)
#   2. relay (node)    — /ice-config + host registry on $RELAY_PORT; spawns coturn
#
# tini is PID 1 (see ENTRYPOINT) so orphan reaping + signal delivery are
# handled. This script's job is to start the two, propagate a shutdown
# signal to both, and exit if either dies (so the container restarts
# as a unit rather than limping along half-up).
#
# bash (not sh): node:24-bookworm-slim is Debian, where bash is Essential, so
# `wait -n` is available — it returns the instant any child exits and reaps it,
# which a POSIX `kill -0` poll can't do (an exited-but-unwaited child stays a
# zombie this script would still see as "alive").

set -u

APP_PORT="${APP_PORT:-8080}"

pids=""

term() {
  # Forward the stop signal to every child; the relay's SIGTERM handler
  # stops coturn, both node services close their listeners cleanly.
  for p in $pids; do
    kill -TERM "$p" 2>/dev/null || true
  done
  wait
  exit 0
}
trap term TERM INT

echo "[supervisor] starting static server on :${APP_PORT}"
# serve -s: single-page-app mode, all unknown routes fall back to index.html
# so the client-side /station route resolves on a hard refresh / deep link.
serve -s /app/www -l "tcp://0.0.0.0:${APP_PORT}" &
pids="$pids $!"

echo "[supervisor] starting relay on :${RELAY_PORT:-3002}"
( cd /app/relay && node dist/index.js ) &
pids="$pids $!"

# Block until the first child exits, then tear the rest down so the
# orchestrator (docker/podman --restart) brings the whole stack back as a unit
# instead of leaving a partial set running. `|| true` keeps a non-zero child
# exit from bypassing the explicit teardown.
wait -n || true
echo "[supervisor] a child process exited — shutting the rest down"
term
