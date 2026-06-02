# Deployment (maintainer reference)

This page is for whoever maintains the deployed gonogo. Day-to-day use runs locally; see the [README](../README.md).

## Frontend (GitHub Pages)

The app is deployed to GitHub Pages at [jonpepler.github.io/gonogo](https://jonpepler.github.io/gonogo/) on every push to `main` that passes CI. The workflow is `.github/workflows/deploy.yml`, triggered on `workflow_run` (CI succeeding on `main`). It builds with `pnpm turbo build --filter=@gonogo/app...` and the Vite base is set to `/gonogo/`.

> The hosted page can't run the **main screen**. The main screen needs to reach your KSP install over a plain `ws://` connection, which a browser blocks from an `https://` page (mixed content), so the main screen always runs locally against your own KSP. What the hosted page is for is **station** screens: a station on someone else's network loads the app from here and joins with the share code.

Requirements:

- GitHub Pages source must be set to **GitHub Actions** in repo settings.
- `VITE_AXIOM_TOKEN` is a GitHub Actions secret, passed through in `deploy.yml` so production logs ship to Axiom. Without the secret the log transport silently doesn't install, and local dev never hits Axiom.

Build locally:

```bash
pnpm build         # output lands in packages/app/dist/
```

## Backend images (GHCR)

The two backend services are published as multi-arch (`linux/amd64`, `linux/arm64`) images to GitHub Container Registry by `.github/workflows/publish-images.yml`:

- `ghcr.io/jonpepler/gonogo-telnet-proxy:latest`
- `ghcr.io/jonpepler/gonogo-relay:latest`

They're also tagged by commit SHA. These let you run the backend on a dedicated mission-control box without a Node toolchain (swap `podman` for `docker` if you prefer):

```bash
podman run -d --name gonogo-telnet-proxy -p 3001:3001 \
  -e KOS_HOST=<ksp-host> -e KOS_PORT=5410 \
  ghcr.io/jonpepler/gonogo-telnet-proxy:latest

podman run -d --name gonogo-relay \
  -p 3002:3002 -p 3478:3478/udp -p 3478:3478/tcp -p 49160-49170:49160-49170/udp \
  -e TURN_EXTERNAL_IP=<public-ip> \
  ghcr.io/jonpepler/gonogo-relay:latest
```

### Port-forwarding for off-network stations

Stations on the same WiFi as the main screen don't touch the relay: both ends are browsers, they meet at the host's derived broker id and connect directly over the LAN. The relay's TURN server only matters for stations out on the internet, which can't reach the host's local addresses and need TURN to bridge the connection.

One honest limitation: a containerized relay on a macOS host can't relay cross-internet traffic. The container's network layer rewrites the inbound source address, which breaks coturn's per-client permissions. To relay cross-internet stations you need the relay on a public Linux box where the TURN ports are directly reachable, not behind a container-on-macOS network rewrite.

For that public-relay case, coturn has to be reachable from outside your network. Forward these ports on your router to the machine running the relay. The ranges match `docker-compose.yml`:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP | TURN signalling |
| `3478` | UDP | TURN signalling |
| `49160–49170` | UDP | TURN relay sessions (one port per active relayed client) |

The relay range is 11 ports (`49160–49170`), sized for up to ~10 simultaneous relayed clients, and kept small because consumer routers want one forward entry per port. If you need more concurrent relayed stations, widen the range in `docker-compose.yml` and `packages/relay/src/coturnManager.ts` together; they must match.

The relay auto-discovers its public IP at startup and advertises it to clients. If your ISP gives you a stable IP, that's all you need; if it rotates, restart the relay when it changes or pin it explicitly with `TURN_EXTERNAL_IP`.

`GET http://localhost:3002/health` reports the relay status, the most recently registered host peer id (diagnostics only; stations don't read this to find the host), and the public IP coturn is advertising. `GET http://localhost:3002/ice-config` returns the iceServers config the main screen fetches on boot. The TURN shared secret rotates on every relay restart and only ever lives in the relay process's memory; never commit a TURN credential to source.

The bundled `docker-compose.yml` builds from local source (so `pnpm dev`'s watcher can rebuild on code changes during development). For a clean deployment, write a minimal compose file that references the `ghcr.io` images directly.

## What's not built yet

The intended **end-user** experience is a no-pnpm path: a packaged main-screen / app container plus a user-facing compose file, so a non-developer never installs Node or pnpm. The backend images above already exist, but the **packaged app/main-screen container and the user-facing compose are not built yet**. Until they are, the pnpm developer path in the README is the working setup.
