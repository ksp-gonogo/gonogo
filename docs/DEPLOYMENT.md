# Deployment (maintainer reference)

This page is for whoever maintains the deployed gonogo. Day-to-day use runs locally; see the [README](../README.md).

## Frontend (GitHub Pages)

> **Currently dormant, and a push to the integration branch is not what wakes it.** Day-to-day work lands on `staging` (see the Workflow section of `CLAUDE.md`), and **a push to `staging` deploys nothing**: CI runs, and that is the end of it, no Pages deploy, no image tags, no mod zips. `deploy.yml`, `publish-images.yml` and `publish-mods.yml` all trigger on CI completing **on `main`**, and `main` has not moved since 2026-07-13, so nothing has deployed since then.
>
> Moving `main` is the operator's call and is not something this page does in passing. When they want it moved, `main` is an ancestor of `staging`, so it is a fast-forward:
>
> ```bash
> git push origin origin/staging:main
> ```
>
> That push is a normal user push, so it does fire CI on `main`, and the dev channel follows it. Everything below describes what happens *when* `main` moves, not what is happening now.

The app is deployed to GitHub Pages at [ksp-gonogo.github.io/gonogo](https://ksp-gonogo.github.io/gonogo/). The workflow is `.github/workflows/deploy.yml`, triggered on `workflow_run` (CI succeeding on `main`) and on `workflow_dispatch`. It builds with `pnpm turbo build --filter=@ksp-gonogo/app...`. One deploy carries both channels: a push to `main` rebuilds `/gonogo/dev/` from that commit, while the root `/gonogo/` is the latest release's site asset rather than anything this run built. See Release and dev channels below.

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

- `ghcr.io/ksp-gonogo/gonogo-relay:latest`

That workflow runs on two triggers and nothing else: CI going green **on `main`** (which publishes the dev channel, `:dev` + `:sha-...`), and a `workflow_dispatch` carrying `channel=release`, which is how `release.yml` moves `:<version>` and `:latest`. Both channels also tag by commit SHA. Nothing on `staging` publishes an image. This lets you run the relay on a dedicated mission-control box without a Node toolchain (swap `podman` for `docker` if you prefer):

```bash
podman run -d --name gonogo-relay \
  -p 3002:3002 -p 3478:3478/udp -p 3478:3478/tcp -p 49160-49170:49160-49170/udp \
  -e TURN_EXTERNAL_IP=<public-ip> \
  ghcr.io/ksp-gonogo/gonogo-relay:latest
```

### Port-forwarding for off-network stations

Stations on the same WiFi as the main screen don't touch the relay: both ends are browsers, they meet at the host's derived broker id and connect directly over the LAN. The relay's TURN server only matters for stations out on the internet, which can't reach the host's local addresses and need TURN to bridge the connection.

For an always-on setup, run the relay on a public Linux box where the TURN ports are directly reachable: it auto-discovers its public IP, needs no home port-forwarding, and stays up. A containerized relay on a macOS host also relays cross-internet traffic, verified end-to-end with a station on cellular, as long as you forward the TURN ports and pin the public IP (below); it's simply a less convenient always-on option than a public host.

Either way, coturn has to be reachable from outside your network. Forward these ports on your router to the machine running the relay. The ranges match `docker-compose.yml`:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP | TURN signalling |
| `3478` | UDP | TURN signalling |
| `49160–49170` | UDP | TURN relay sessions (one port per active relayed client) |

The relay range is 11 ports (`49160–49170`), sized for up to ~10 simultaneous relayed clients, and kept small because consumer routers want one forward entry per port. If you need more concurrent relayed stations, widen it with `TURN_MIN_PORT` / `TURN_MAX_PORT` on the relay, publish the same range from the container (`docker-compose.yml` reads the same two variables), and widen the router forwards to match; all three must agree.

The relay auto-discovers its public IP at startup and advertises it to clients. If your ISP gives you a stable IP, that's all you need; if it rotates, restart the relay when it changes or pin it explicitly with `TURN_EXTERNAL_IP=<your public IP>` in the environment.

**Local dev with remote stations.** `scripts/dev.sh` auto-detects the host's LAN IP and passes it to coturn, correct for same-WiFi stations but unreachable from the internet. To support a remote/off-LAN station from a local dev setup, set your public IP in the repo-root `.env`:

```
TURN_EXTERNAL_IP=<your public IP>
```

`curl ifconfig.me` gives your current public IP. An explicit `TURN_EXTERNAL_IP` always overrides auto-detection. With the public IP pinned and the TURN ports forwarded, a containerized relay on macOS relays cross-internet stations fine, verified end-to-end.

`GET http://localhost:3002/health` reports the relay status, the most recently registered host peer id (diagnostics only; stations don't read this to find the host), and the public IP coturn is advertising. `GET http://localhost:3002/version` returns `{ version, buildTime }` for the running container, which is how you tell which image a box is actually on; the release number is baked in as `GONOGO_VERSION` at image build time, and a relay started from source falls back to `packages/relay/package.json`'s own version instead. `GET http://localhost:3002/ice-config` returns the iceServers config the main screen fetches on boot. The TURN shared secret rotates on every relay restart and only ever lives in the relay process's memory; never commit a TURN credential to source.

The bundled `docker-compose.yml` builds from local source (so `pnpm dev`'s watcher can rebuild on code changes during development). For a clean deployment, write a minimal compose file that references the `ghcr.io` images directly.

## End-user bundle

The end-user path is a single image, `ghcr.io/ksp-gonogo/gonogo:latest`, that runs the app and the relay together under one supervisor (built from `Dockerfile.bundle`, published by the `publish-bundle` job in `.github/workflows/publish-images.yml`, on the same two triggers and with the same tags as the relay image above). A non-developer never installs Node or pnpm; they run the `docker run` line in the [README](../README.md). The per-service image and the dev `docker-compose.yml` above are still what contributors use day to day.

## Release and dev channels

Everything user-facing moves only when a release is cut. A CI-green push to `main` moves a separate dev channel, and **a push to `staging` moves neither**: CI runs, nothing publishes. Same model as kerbcast.

| Surface | Release channel | Dev channel (CI-green push to `main`) |
| --- | --- | --- |
| Pages site | `ksp-gonogo.github.io/gonogo/` | `ksp-gonogo.github.io/gonogo/dev/` (stations: `/gonogo/dev/station`) |
| Bundle image | `ghcr.io/ksp-gonogo/gonogo:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo:dev` |
| Relay image | `ghcr.io/ksp-gonogo/gonogo-relay:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo-relay:dev` |
| Mod GameData zips | attached to the GitHub Release, and pushed to SpaceDock | built and kept as a CI artifact only |
| npm packages | `ui-kit` / `sitrep-sdk`, each only if its own version moved | never published |
| App version | `X.Y.Z` | `X.Y.Z-dev.<shortsha>` |

Both images also carry a `sha-<commit>` tag in both channels. `gonogo` and `gonogo-relay` are the only two images; there is no third service image.

**Cutting a release.** Two steps, because the dispatch runs on `main` and `main` is not where the work is:

```bash
git push origin origin/staging:main               # fast-forward main to the integration branch
gh workflow run prepare-release.yml --ref main    # then cut
```

The first step is not a nicety. `prepare-release.yml` fails the run when the dispatched ref is missing commits that are on `staging`, printing how many and the fast-forward command, so a release of the frozen `main` tree cannot happen quietly. (Dispatching on `staging` itself passes the same check and fast-forwards `main` as a side effect of the release push; the two-step above keeps moving `main` an explicit act.)

The `bump` input accepts `auto` (the default), `patch`, `minor` or `major`; force one with `-f bump=minor`. `auto` analyses conventional commits since the last tag, `feat:` → minor, `BREAKING CHANGE`/`!` → major, anything else → patch, and fails the run outright when that range is empty rather than re-cutting an already-released tree. Override it whenever `auto` would understate the change: the bump size *is* the wire-compatibility promise in the skew table below, and `auto` only reads commit subjects.

**What a release moves.** `prepare-release.yml` bumps `packages/app/package.json`, commits `release: vX.Y.Z`, tags, pushes the commit and the tag to `main`, returns the release commit to `staging` (so `main` can still be fast-forwarded next time), then dispatches `release.yml` on the tag. `release.yml` runs the full test suite at the tag, and then:

- uploads the production site as the GitHub Release asset `gonogo-site.tar.gz`,
- dispatches `publish-images.yml` with `channel=release`, tagging `gonogo` and `gonogo-relay` `:<version>` + `:latest`,
- dispatches `publish-mods.yml` with `channel=release`, attaching each mod GameData zip in that workflow's matrix to the Release and pushing it to SpaceDock (a mod whose `vars.SPACEDOCK_MOD_ID_*` repo variable is unset warns and skips the SpaceDock half instead of failing),
- dispatches `deploy.yml` so the Pages root flips to this release immediately rather than on the next push to `main`,
- publishes `@ksp-gonogo/ui-kit` and `@ksp-gonogo/sitrep-sdk` to npm, each only if its own `package.json` version has moved. An unchanged version is skipped, but the skip is checked against the published tarball, so a package whose version stopped moving while its code kept moving fails the release instead of going quiet.

The version in `packages/app/package.json` only ever changes through this flow. Never hand-edit it in either direction: `release.yml` refuses a tag that disagrees with it, so an edit breaks the next release rather than undoing the last one.

The release commit is pushed with `GITHUB_TOKEN`, and token pushes do not fire workflow triggers, so **CI never runs on the release commit** and none of the three `workflow_run` publishers fire for it. Each is dispatched by `release.yml` explicitly, in the order above; there is no second Pages run racing the release.

**How the Pages site holds both channels:** `deploy.yml` runs on every CI-green push to `main`, builds the dev app (`base /gonogo/dev/`, `-dev.<shortsha>` suffix), downloads the newest release's `gonogo-site.tar.gz` for the root, and deploys the composed artifact. Until the first release exists, the dev build serves the root too. `release.yml` dispatches that same job, so a release never wipes the dev channel: the root takes the new release asset and `/dev/` is rebuilt from `main`'s HEAD, which at that moment *is* the release commit. Straight after a cut the two channels are the same tree, one of them suffixed `-dev.<shortsha>`.

**Checking a release landed.** A release fans out into three further workflow runs, so `release.yml` going green is not the whole answer:

```bash
gh run list --limit 10                                     # release.yml plus what it dispatched
gh release view v<X.Y.Z> --json assets --jq '.assets[].name'

curl -s https://ksp-gonogo.github.io/gonogo/     | grep gonogo-version
curl -s https://ksp-gonogo.github.io/gonogo/dev/ | grep gonogo-version
```

Every build stamps `<meta name="gonogo-version">` and `<meta name="gonogo-build-time">` into the page shell for exactly this, so both channels can be read without dev-tools. The same string is baked into the JS as `__GONOGO_VERSION__` and announced in the peer `hello` handshake. For the images, `podman pull ghcr.io/ksp-gonogo/gonogo:<version>` proves the tag exists, and a running relay answers `GET /version`.

**Rolling back.** There is no undo command, and the sanctioned move is forward: fix, and cut the next release. If the root has to serve the previous release *now*, demote the bad one and re-compose, because the root follows whatever GitHub calls the latest release and a pre-release is not it:

```bash
gh release edit v<bad> --prerelease
gh workflow run deploy.yml --ref main                              # root falls back to the previous release asset
gh workflow run publish-images.yml --ref v<previous> -f channel=release   # moves :latest back
```

Two things do not come back. An npm publish cannot be undone, so a bad `ui-kit` or `sitrep-sdk` needs a further version. And a version number is spent once: undoing a bump by editing `packages/app/package.json` only desynchronises it from the tags, so roll forward past a bad version instead.

**Version-skew detection:** Vite bakes the version into the build (`__GONOGO_VERSION__`), the host announces it in the peer `hello` handshake, stations report theirs back in `station-info`. Stations render a mismatch banner per the table below, and the main screen's GO/NO-GO grid shows a version chip per skewed station. The bump size states the wire-compatibility promise:

| Bump | Meaning | Station UX against a skewed host |
| --- | --- | --- |
| patch | wire-compatible fix | silent (log line only) |
| minor | new features, still interoperates | advisory mismatch banner |
| major | peer protocol broke | mismatch banner; expect breakage |

Dev builds compare by their base `X.Y.Z` (the `-dev.<shortsha>` suffix is ignored), so a dev station against the release it forked from is silent. Because stations always load the newest deploy of their channel while main screens run a container pulled at install time, skew is normal, the banner is the nudge to `docker pull`. When changing the peer protocol, keep new message fields optional (the codebase already follows this) so a minor-skewed pair degrades instead of crashing.

**One caveat for dev testing:** `/gonogo/` and `/gonogo/dev/` share an origin, so a dev station and a release station on the same device share localStorage, layout, station identity, share-code. Convenient (your station keeps its identity across channels) but a dev-channel layout experiment edits the same saved layout the release station uses.
