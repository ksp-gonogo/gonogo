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

- `pnpm dev` starts the app and the relay container. It reads this computer's LAN address and the router from the default route and passes them as `LAN_IP` and `ROUTER_IP`, which saves typing the router's address on a dev machine. Put `GONOGO_AUTO_PORT_FORWARD=1` in the repo-root `.env` to let the relay open its port on the router
- The relay runs the station endpoint, a Go program under `packages/relay/endpoint` that the relay image builds. Every station joins through it on port `47100`, UDP and TCP, while it runs. `pnpm --filter @ksp-gonogo/relay endpoint:build` builds it beside the relay for a relay run outside the container, and `endpoint:test` runs its tests (both need Go). `SKIP_ENDPOINT=1` runs the relay without it, and stations then join the main screen directly
- Unless automatic port forwarding is on (the app's Settings, Relay, or `GONOGO_AUTO_PORT_FORWARD=1` at start), the relay never contacts the router. The main screen switches it with `POST /port-forward` on port 3002. With it on, the relay asks only the router whose address it was given (the app's Your router's IP address setting, or `ROUTER_IP` until the app sends one), and a UPnP router forwards to `LAN_IP`
- The main screen looks for the relay at `http://localhost:3002`. A build with the relay elsewhere sets `VITE_RELAY_URL` at build time
- The relay answers only the app's own pages and the public site. Another origin goes in `RELAY_APP_ORIGINS` (comma-separated)
- `GET /health` and `/version` on port 3002 report the relay and endpoint status and the image version, and the main screen's socket to the endpoint is `/stations` on the same port. Keep `3002` closed to the internet: only `47100` is forwarded

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
