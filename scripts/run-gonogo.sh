#!/usr/bin/env bash
# Launch the gonogo end-user bundle: the whole LOCAL stack (app + relay +
# station endpoint) in one container. No repo clone, no compose file.
#
#   ./scripts/run-gonogo.sh           # docker (default)
#   CONTAINER=podman ./scripts/run-gonogo.sh
#   IMAGE=ghcr.io/ksp-gonogo/gonogo:latest ./scripts/run-gonogo.sh
#
# Then open http://localhost:8080. The main screen talks to KSP directly
# from your browser; the relay (3002) runs inside this container. The port
# maps below mirror docker-compose.yml: 47100 on UDP and TCP is the one port
# stations on other networks connect through.
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

# The station endpoint gives stations on this network this computer's LAN
# address, which the container cannot see for itself. Set LAN_IP to override.
if [ -z "${LAN_IP:-}" ]; then
  if route_out=$(route -n get default 2>/dev/null); then
    iface=$(printf '%s\n' "$route_out" | awk '/interface:/{print $2; exit}')
    LAN_IP=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  elif command -v ip >/dev/null 2>&1; then
    LAN_IP=$(ip route get 1.1.1.1 2>/dev/null |
      awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
  fi
fi
[ -n "${LAN_IP:-}" ] && EXTRA_ARGS+=(-e LAN_IP="$LAN_IP")

exec "$CONTAINER" run -d --name "$NAME" --restart unless-stopped \
  -p 8080:8080 \
  -p 127.0.0.1:3002:3002 \
  -p 47100:47100/udp \
  -p 47100:47100/tcp \
  "${EXTRA_ARGS[@]}" \
  "$IMAGE"
