#!/usr/bin/env bash
# Launch the gonogo end-user bundle: the whole LOCAL stack (app + relay +
# telnet-proxy + coturn) in one container. No repo clone, no compose file.
#
#   ./scripts/run-gonogo.sh           # docker (default)
#   CONTAINER=podman ./scripts/run-gonogo.sh
#   IMAGE=ghcr.io/jonpepler/gonogo:latest ./scripts/run-gonogo.sh
#
# Then open http://localhost:8080. The main screen talks to KSP's Telemachus
# directly from your browser; the relay (3002) + telnet-proxy (3001) run
# inside this container. The port maps below mirror docker-compose.yml
# exactly so coturn's TURN relay works for remote stations.
set -euo pipefail

CONTAINER="${CONTAINER:-docker}"
IMAGE="${IMAGE:-ghcr.io/jonpepler/gonogo:latest}"
NAME="${NAME:-gonogo}"

# The in-container telnet-proxy dials KSP/kOS on the host. Podman provides
# host.containers.internal natively; Docker on Linux needs the host-gateway
# alias added explicitly. Override KOS_HOST if KSP runs on another machine.
EXTRA_ARGS=()
if [ "$(basename "$CONTAINER")" = "docker" ]; then
  EXTRA_ARGS+=(--add-host=host.docker.internal:host-gateway)
  EXTRA_ARGS+=(-e KOS_HOST="${KOS_HOST:-host.docker.internal}")
elif [ -n "${KOS_HOST:-}" ]; then
  EXTRA_ARGS+=(-e KOS_HOST="$KOS_HOST")
fi

exec "$CONTAINER" run -d --name "$NAME" --restart unless-stopped \
  -p 8080:8080 \
  -p 3001:3001 \
  -p 3002:3002 \
  -p 3478:3478/tcp \
  -p 3478:3478/udp \
  -p 49160-49170:49160-49170/udp \
  "${EXTRA_ARGS[@]}" \
  "$IMAGE"
