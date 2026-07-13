# Deployment (maintainer reference)

This page is for whoever maintains the deployed gonogo. Day-to-day use runs locally; see the [README](../README.md).

## Frontend (GitHub Pages)

The app is deployed to GitHub Pages at [jonpepler.github.io/gonogo](https://jonpepler.github.io/gonogo/) on every push to `main` that passes CI. The workflow is `.github/workflows/deploy.yml`, triggered on `workflow_run` (CI succeeding on `main`). It builds with `pnpm turbo build --filter=@ksp-gonogo/app...` and the Vite base is set to `/gonogo/`.

> The hosted page can't run the **main screen**. The main screen needs to reach your KSP install over a plain `ws://` connection, which a browser blocks from an `https://` page (mixed content), so the main screen always runs locally against your own KSP. What the hosted page is for is **station** screens: a station on someone else's network loads the app from here and joins with the share code.

Requirements:

- GitHub Pages source must be set to **GitHub Actions** in repo settings.
- `VITE_AXIOM_TOKEN` is a GitHub Actions secret, passed through in `deploy.yml` so production logs ship to Axiom. Without the secret the log transport silently doesn't install, and local dev never hits Axiom.

Build locally:

```bash
pnpm build         # output lands in packages/app/dist/
```

## Backend image (GHCR)

The relay service is published as a multi-arch (`linux/amd64`, `linux/arm64`) image to GitHub Container Registry by `.github/workflows/publish-images.yml`:

- `ghcr.io/jonpepler/gonogo-relay:latest`

It's also tagged by commit SHA. This lets you run the relay on a dedicated mission-control box without a Node toolchain (swap `podman` for `docker` if you prefer):

```bash
podman run -d --name gonogo-relay \
  -p 3002:3002 -p 3478:3478/udp -p 3478:3478/tcp -p 49160-49170:49160-49170/udp \
  -e TURN_EXTERNAL_IP=<public-ip> \
  ghcr.io/jonpepler/gonogo-relay:latest
```

### Port-forwarding for off-network stations

Stations on the same WiFi as the main screen don't touch the relay: both ends are browsers, they meet at the host's derived broker id and connect directly over the LAN. The relay's TURN server only matters for stations out on the internet, which can't reach the host's local addresses and need TURN to bridge the connection.

For an always-on setup, run the relay on a public Linux box where the TURN ports are directly reachable: it auto-discovers its public IP, needs no home port-forwarding, and stays up. A containerized relay on a macOS host also relays cross-internet traffic — verified end-to-end with a station on cellular — as long as you forward the TURN ports and pin the public IP (below); it's simply a less convenient always-on option than a public host.

Either way, coturn has to be reachable from outside your network. Forward these ports on your router to the machine running the relay. The ranges match `docker-compose.yml`:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP | TURN signalling |
| `3478` | UDP | TURN signalling |
| `49160–49170` | UDP | TURN relay sessions (one port per active relayed client) |

The relay range is 11 ports (`49160–49170`), sized for up to ~10 simultaneous relayed clients, and kept small because consumer routers want one forward entry per port. If you need more concurrent relayed stations, widen the range in `docker-compose.yml` and `packages/relay/src/coturnManager.ts` together; they must match.

The relay auto-discovers its public IP at startup and advertises it to clients. If your ISP gives you a stable IP, that's all you need; if it rotates, restart the relay when it changes or pin it explicitly with `TURN_EXTERNAL_IP=<your public IP>` in the environment.

**Local dev with remote stations.** `scripts/dev.sh` auto-detects the host's LAN IP and passes it to coturn — correct for same-WiFi stations but unreachable from the internet. To support a remote/off-LAN station from a local dev setup, set your public IP in the repo-root `.env`:

```
TURN_EXTERNAL_IP=<your public IP>
```

`curl ifconfig.me` gives your current public IP. An explicit `TURN_EXTERNAL_IP` always overrides auto-detection. With the public IP pinned and the TURN ports forwarded, a containerized relay on macOS relays cross-internet stations fine — verified end-to-end.

`GET http://localhost:3002/health` reports the relay status, the most recently registered host peer id (diagnostics only; stations don't read this to find the host), and the public IP coturn is advertising. `GET http://localhost:3002/ice-config` returns the iceServers config the main screen fetches on boot. The TURN shared secret rotates on every relay restart and only ever lives in the relay process's memory; never commit a TURN credential to source.

The bundled `docker-compose.yml` builds from local source (so `pnpm dev`'s watcher can rebuild on code changes during development). For a clean deployment, write a minimal compose file that references the `ghcr.io` images directly.

## End-user bundle

The end-user path is a single image, `ghcr.io/jonpepler/gonogo:latest`, that runs the app and the relay together under one supervisor (built from `Dockerfile.bundle`, published by the `publish-bundle` job in `.github/workflows/publish-images.yml`). A non-developer never installs Node or pnpm; they run the `docker run` line in the [README](../README.md). The per-service image and the dev `docker-compose.yml` above are still what contributors use day to day.

## Release and dev channels

Everything user-facing moves only when a release is cut; pushes to `main` move a separate dev channel. Same model as kerbcast.

| Surface | Release channel | Dev channel (every CI-green push to `main`) |
| --- | --- | --- |
| Pages site | `jonpepler.github.io/gonogo/` | `jonpepler.github.io/gonogo/dev/` (stations: `/gonogo/dev/station`) |
| Bundle image | `ghcr.io/jonpepler/gonogo:<version>` + `:latest` | `ghcr.io/jonpepler/gonogo:dev` (+ `:sha-…`) |
| Service images | same pattern | same pattern |
| App version | `X.Y.Z` | `X.Y.Z-dev.<shortsha>` |

**Cutting a release:**

```bash
gh workflow run prepare-release.yml --ref main
```

(or Actions → prepare-release → Run workflow; the `bump` input defaults to `auto`, which analyses conventional commits since the last tag — `feat:` → minor, `BREAKING CHANGE`/`!` → major, anything else → patch.)

`prepare-release.yml` bumps `packages/app/package.json`, commits `release: vX.Y.Z`, tags, pushes, and dispatches `release.yml`, which runs the full test suite at the tag, builds the production site, uploads it as the GitHub Release asset `gonogo-site.tar.gz`, publishes the `:<version>`/`:latest` images, and redeploys Pages. The version in `package.json` should only ever change through this flow.

**How the Pages site holds both channels:** `deploy.yml` runs on every CI-green push to `main`, builds the dev app (`base /gonogo/dev/`, `-dev.<shortsha>` suffix), downloads the newest release's `gonogo-site.tar.gz` for the root, and deploys the composed artifact. Until the first release exists, the dev build serves the root too.

**Version-skew detection:** Vite bakes the version into the build (`__GONOGO_VERSION__`), the host announces it in the peer `hello` handshake, stations report theirs back in `station-info`. Stations render a mismatch banner per the table below, and the main screen's GO/NO-GO grid shows a version chip per skewed station. The bump size states the wire-compatibility promise:

| Bump | Meaning | Station UX against a skewed host |
| --- | --- | --- |
| patch | wire-compatible fix | silent (log line only) |
| minor | new features, still interoperates | advisory mismatch banner |
| major | peer protocol broke | mismatch banner; expect breakage |

Dev builds compare by their base `X.Y.Z` (the `-dev.…` suffix is ignored), so a dev station against the release it forked from is silent. Because stations always load the newest deploy of their channel while main screens run a container pulled at install time, skew is normal — the banner is the nudge to `docker pull`. When changing the peer protocol, keep new message fields optional (the codebase already follows this) so a minor-skewed pair degrades instead of crashing.

**One caveat for dev testing:** `/gonogo/` and `/gonogo/dev/` share an origin, so a dev station and a release station on the same device share localStorage — layout, station identity, share-code. Convenient (your station keeps its identity across channels) but a dev-channel layout experiment edits the same saved layout the release station uses.
