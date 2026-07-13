#!/usr/bin/env bash
# Launch the gonogo end-user bundle: the whole LOCAL stack (app + relay +
# coturn) in one container. No repo clone, no compose file.
#
#   ./scripts/run-gonogo.sh           # docker (default)
#   CONTAINER=podman ./scripts/run-gonogo.sh
#   IMAGE=ghcr.io/ksp-gonogo/gonogo:latest ./scripts/run-gonogo.sh
#
# Then open http://localhost:8080. The main screen talks to KSP directly
# from your browser; the relay (3002) runs inside this container. The port
# maps below mirror docker-compose.yml exactly so coturn's TURN relay works
# for remote stations.
set -euo pipefail

CONTAINER="${CONTAINER:-docker}"
IMAGE="${IMAGE:-ghcr.io/ksp-gonogo/gonogo:latest}"
NAME="${NAME:-gonogo}"

# The relay republishes KSP_HOST at /bootstrap-config so the SPA seeds its
# data-source defaults. Podman provides host.containers.internal natively;
# Docker on Linux needs the host-gateway alias added explicitly. Override
# KSP_HOST if KSP runs on another machine.
EXTRA_ARGS=()
if [ "$(basename "$CONTAINER")" = "docker" ]; then
  EXTRA_ARGS+=(--add-host=host.docker.internal:host-gateway)
  EXTRA_ARGS+=(-e KSP_HOST="${KSP_HOST:-host.docker.internal}")
elif [ -n "${KSP_HOST:-}" ]; then
  EXTRA_ARGS+=(-e KSP_HOST="$KSP_HOST")
fi

exec "$CONTAINER" run -d --name "$NAME" --restart unless-stopped \
  -p 8080:8080 \
  -p 3002:3002 \
  -p 3478:3478/tcp \
  -p 3478:3478/udp \
  -p 49160-49170:49160-49170/udp \
  "${EXTRA_ARGS[@]}" \
  "$IMAGE"
