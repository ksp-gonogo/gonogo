# Contributing to gonogo

Contributions are welcome. Writing an Uplink (a widget, a data source or a mod extension of your own) does not need a change here: the [Uplink developer docs](https://ksp-gonogo.github.io/uplink-dev-docs/) cover building and publishing one.

## Setup

You need Node 24 (`nvm use` reads `.nvmrc`) and pnpm 10.

```bash
git clone https://github.com/<you>/gonogo.git
cd gonogo
pnpm install    # also installs the git hooks in .githooks
pnpm build
pnpm --filter @ksp-gonogo/app dev
```

`pnpm --filter @ksp-gonogo/app dev` starts the app without the relay, so the first setup step reports no answer from the app until you run the relay too (`pnpm dev` starts both). [docs/KSP-SETUP.md](docs/KSP-SETUP.md) covers connecting the app to the game.

## Running the relay

- `pnpm dev` starts the app and the relay container. It reads this computer's LAN address and the router from the default route, passes the address as `TURN_EXTERNAL_IP` (so stations on the same WiFi relay through this machine) and the router as `ROUTER_IP` and `LAN_IP`. Put `TURN_EXTERNAL_IP=<your public IP>` in the repo-root `.env` to test with stations on the internet, and `GONOGO_UPNP=1` to let the relay open the router ports
- Without `GONOGO_UPNP=1` the relay never contacts the router. With it, a container on the computer's own network (`--network host`) reads the real default route, while one on Docker Desktop or a bridge asks the usual router addresses and every `.1` and `.254` of the `192.168.x.x` networks, so `ROUTER_IP` and `LAN_IP` name them when that fails
- The main screen looks for the relay at `http://localhost:3002`. A build with the relay elsewhere sets `VITE_RELAY_URL` at build time
- The relay answers only the app's own pages and the public site. Another origin goes in `RELAY_APP_ORIGINS` (comma-separated)
- `GET /health`, `/version` and `/ice-config` on port 3002 report the relay status, the image version, and the relay address and credentials the main screen reads on boot. Keep `3002` closed to the internet
- To let a station fetch the relay details from its link before it has connected, set `RELAY_HTTP_BIND=0.0.0.0` and `RELAY_PUBLIC_URL=https://<address>` where the address is an https reverse proxy with a certificate in front of `3002`. Anyone holding that link can read the relay's time-limited credentials. Unset, a station learns the relay from the main screen once connected
- To run the relay alone on a public host, use the `ghcr.io/ksp-gonogo/gonogo-relay` image with the same ports and `RELAY_PUBLIC=1`
- `TURN_TCP=1` adds a TCP relay address for stations on a network that blocks UDP, which doubles the ports each relayed connection holds

## Making a change

1. Fork the repository and branch off `staging`, the integration branch. `main` moves only at a release
2. Before you push, run:
   - `pnpm exec biome check .` (verify only; `pnpm lint` fixes in place)
   - the tests of each package you changed, for example `pnpm --filter @ksp-gonogo/components test`
   - `pnpm build`
3. Open a pull request against `staging`. CI runs on it; a first-time contributor's run waits for a maintainer to approve it

The pre-commit hook runs Biome and the type check. Do not skip it with `--no-verify`.

## Commit subjects

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...), with a subject of 100 characters at most. The subjects become the public changelog, so write one a player can read: what changed for them, not which files moved. A commit is a subject only: `.githooks/commit-msg` refuses a body, and any reference to a private tracker ticket. Put the detail in the pull request description.
