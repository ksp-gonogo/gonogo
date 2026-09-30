# Deployment (maintainer reference)

This page is for whoever maintains the deployed gonogo. Day-to-day use runs locally; see the [README](../README.md).

## Frontend (GitHub Pages)

> **Where the work goes.** Day-to-day work lands on `staging`, which deploys nothing by itself. The release-candidate channel is built from `staging` by `rc.yml`, nightly and on demand; `main` moves only when a release is cut. The remote default branch is `main`, on purpose: it is the real latest version, what a new visitor sees. See Release and RC channels below.

The app is deployed to GitHub Pages at [ksp-gonogo.github.io/gonogo](https://ksp-gonogo.github.io/gonogo/). The workflow is `.github/workflows/deploy.yml`, called by `rc.yml` and dispatched by `release.yml`; nothing triggers it on a push. It builds with `pnpm turbo build --filter=@ksp-gonogo/app...`. One deploy carries both channels: it rebuilds `/gonogo/rc/` from the commit it is given, while the root `/gonogo/` is the latest release's site asset rather than anything this run built. See Release and RC channels below.

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

That workflow runs on two triggers and nothing else: `rc.yml` calling it with `channel=rc` (`:rc` + `:sha-...`), and a `workflow_dispatch` carrying `channel=release`, which is how `release.yml` moves `:<version>` and `:latest`. Both channels also tag by commit SHA. A push to a branch publishes no image. Old `:dev` tags stay on GHCR; nothing removes them. This lets you run the relay on a dedicated mission-control box without a Node toolchain (swap `podman` for `docker` if you prefer):

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

## Release and RC channels

Everything user-facing moves only when a release is cut. A separate release-candidate (RC) channel is built from the head of `staging` by `rc.yml`, every night at 03:00 UTC and on demand. A push to a branch publishes nothing.

| Surface | Release channel | RC channel (`rc.yml`) |
| --- | --- | --- |
| Pages site | `ksp-gonogo.github.io/gonogo/` | `ksp-gonogo.github.io/gonogo/rc/` (stations: `/gonogo/rc/station`) |
| Bundle image | `ghcr.io/ksp-gonogo/gonogo:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo:rc` |
| Relay image | `ghcr.io/ksp-gonogo/gonogo-relay:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo-relay:rc` |
| Mod GameData zips | attached to the GitHub Release, and pushed to SpaceDock | built and kept as a CI artifact only (`rc-<shortsha>`) |
| npm packages | `ui-kit` / `sitrep-sdk`, each only if its own version moved | never published |
| NuGet package | `KspGonogo.Sitrep.Contract`, only if the contract version moved | never published (CI packs, gates and probes it) |
| App version | `X.Y.Z` | `X.Y.Z-rc.<shortsha>` |

Both images also carry a `sha-<commit>` tag in both channels. `gonogo` and `gonogo-relay` are the only two images; there is no third service image. The earlier dev channel (`/gonogo/dev/`, `:dev`) is gone: the first Pages deploy of the new layout replaces the whole site, so `/gonogo/dev/` disappears, while old `:dev` image tags linger on GHCR.

**How an RC is built.** `rc.yml` checks out `staging` and acts on its head sha:

- it does nothing when `rc-<shortsha>` already exists. That tag is the record of the last RC: it is written only after Pages, images and mod zips all finished, so a failed RC leaves none and the next night retries. The `force` input rebuilds a sha that already has a tag
- it does nothing when the head is a release commit (a `v*` tag points at it)
- it refuses a sha unless every CI run of it passed. CI does not run on `staging` (`ci-dev-forward.yml` pushes there with `GITHUB_TOKEN`, which starts no workflow); it runs on `ci-dev` at the same sha. `scripts/ci-dev-forward-verdict.sh` reads the runs of that sha across every branch, the same rule the forwarder applies. `force` does not bypass it
- it calls `deploy.yml`, `publish-images.yml` and `publish-mods.yml` at `@staging` with that sha

```bash
gh workflow run rc.yml --ref staging              # build the RC now
gh workflow run rc.yml --ref staging -f force=true
```

**Why `rc.yml` names `@staging`.** `schedule` runs the copy of the workflow on the default branch, `main`, which moves only at a release. A `./` call would resolve to main's copies of the publishers. Naming `@staging` means only `rc.yml` itself has to be on `main` for the nightly to start.

**Cutting a release.** One dispatch, on `staging`:

```bash
gh workflow run prepare-release.yml --ref staging
```

`prepare-release.yml` refuses any other ref, and refuses when `main` has commits `staging` lacks (it cannot be fast-forwarded), printing how many. Otherwise it commits the version bump on top of `staging`, which fast-forwards `main` to it, then carries on as below.

The `bump` input accepts `auto` (the default), `patch`, `minor` or `major`; force one with `-f bump=minor`. `auto` analyses conventional commits since the last tag, `feat:` → minor, `BREAKING CHANGE`/`!` → major, anything else → patch, and fails the run outright when that range is empty rather than re-cutting an already-released tree. Override it whenever `auto` would understate the change: the bump size *is* the wire-compatibility promise in the skew table below, and `auto` only reads commit subjects.

**What a release moves.** `prepare-release.yml` bumps `packages/app/package.json`, commits `release: vX.Y.Z`, tags, pushes the commit and the tag to `main`, returns the release commit to `staging` (so `main` can still be fast-forwarded next time), then dispatches `release.yml` on the tag. `release.yml` runs the full test suite at the tag, and then:

- uploads the production site as the GitHub Release asset `gonogo-site.tar.gz`,
- dispatches `publish-images.yml` with `channel=release`, tagging `gonogo` and `gonogo-relay` `:<version>` + `:latest`,
- dispatches `publish-mods.yml` with `channel=release`, attaching each mod GameData zip in that workflow's matrix to the Release and pushing it to SpaceDock (a mod whose `vars.SPACEDOCK_MOD_ID_*` repo variable is unset warns and skips the SpaceDock half instead of failing),
- dispatches `deploy.yml` so the Pages root flips to this release immediately rather than on the next RC,
- publishes `@ksp-gonogo/ui-kit` and `@ksp-gonogo/sitrep-sdk` to npm, each only if its own `package.json` version has moved. An unchanged version is skipped, but the skip is checked against the published tarball, so a package whose version stopped moving while its code kept moving fails the release instead of going quiet.
- publishes `KspGonogo.Sitrep.Contract` to nuget.org when its version is not there yet. The version is `Major.Minor.PackagePatch`: `Major.Minor` is the contract's own, read from `ContractVersion.cs`; `PackagePatch` is the package's own (Sitrep.Contract.Package.csproj), for a change to `Sitrep.Contract.TestSupport` or `Sitrep.Core` (both ship inside the package) with no contract move. The `publish-nuget` job packs once with both determinism flags set, gates that file, builds `GonogoProbeUplink` (`scripts/nuget-probe-uplink/`, kept here only to be probed) against it outside the repo (plus a planted gap that must fail), and pushes the same file. When the version IS already on nuget.org, it downloads that published copy and compares it against the fresh pack with the build-identity regions (PE timestamp, debug-directory timestamps, PDB id, PDB checksum, module MVID) normalised out; a real difference fails the release asking for a `PackagePatch` bump rather than skipping silently. It authenticates through nuget.org trusted publishing, bound to `release.yml` with no environment, and needs the `NUGET_USER` secret: the nuget.org profile name that owns the policy. There is no API key.

The version in `packages/app/package.json` only ever changes through this flow. Never hand-edit it in either direction: `release.yml` refuses a tag that disagrees with it, so an edit breaks the next release rather than undoing the last one.

The release commit is pushed with `GITHUB_TOKEN`, and token pushes do not fire workflow triggers, so **CI never runs on the release commit**, and therefore `rc.yml` builds no RC for it either. Each publisher is dispatched by `release.yml` explicitly, in the order above; there is no second Pages run racing the release.

**How the Pages site holds both channels:** `deploy.yml` builds the RC app (`base /gonogo/rc/`, `-rc.<shortsha>` suffix) from the commit it is given, downloads the newest release's `gonogo-site.tar.gz` for the root, and deploys the composed artifact. Until the first release exists, the RC build serves the root too. `release.yml` dispatches that same job, so a release never wipes the RC channel: the root takes the new release asset and `/rc/` is rebuilt from the release commit. Straight after a cut the two channels are the same tree, one of them suffixed `-rc.<shortsha>`.

**Checking a release landed.** A release fans out into three further workflow runs, so `release.yml` going green is not the whole answer:

```bash
gh run list --limit 10                                     # release.yml plus what it dispatched
gh release view v<X.Y.Z> --json assets --jq '.assets[].name'

curl -s https://ksp-gonogo.github.io/gonogo/     | grep gonogo-version
curl -s https://ksp-gonogo.github.io/gonogo/rc/ | grep gonogo-version
```

Every build stamps `<meta name="gonogo-version">` and `<meta name="gonogo-build-time">` into the page shell for exactly this, so both channels can be read without dev-tools. The same string is baked into the JS as `__GONOGO_VERSION__` and announced in the peer `hello` handshake. For the images, `podman pull ghcr.io/ksp-gonogo/gonogo:<version>` proves the tag exists, and a running relay answers `GET /version`.

**Rolling back.** There is no undo command, and the sanctioned move is forward: fix, and cut the next release. If the root has to serve the previous release *now*, demote the bad one and re-compose, because the root follows whatever GitHub calls the latest release and a pre-release is not it:

```bash
gh release edit v<bad> --prerelease
gh workflow run deploy.yml --ref main                              # root falls back to the previous release asset
gh workflow run publish-images.yml --ref v<previous> -f channel=release   # moves :latest back
```

Two things do not come back. An npm or NuGet publish cannot be undone, so a bad `ui-kit`, `sitrep-sdk` or `KspGonogo.Sitrep.Contract` needs a further version (nuget.org can unlist a version, which hides it from search but still serves it to anyone who pinned it). And a version number is spent once: undoing a bump by editing `packages/app/package.json` only desynchronises it from the tags, so roll forward past a bad version instead.

**Version-skew detection:** Vite bakes the version into the build (`__GONOGO_VERSION__`), the host announces it in the peer `hello` handshake, stations report theirs back in `station-info`. Stations render a mismatch banner per the table below, and the main screen's GO/NO-GO grid shows a version chip per skewed station. The bump size states the wire-compatibility promise:

| Bump | Meaning | Station UX against a skewed host |
| --- | --- | --- |
| patch | wire-compatible fix | silent (log line only) |
| minor | new features, still interoperates | advisory mismatch banner |
| major | peer protocol broke | mismatch banner; expect breakage |

RC builds compare by their base `X.Y.Z` (the `-rc.<shortsha>` suffix is ignored), so an RC station against the release it forked from is silent. Because stations always load the newest deploy of their channel while main screens run a container pulled at install time, skew is normal, the banner is the nudge to `docker pull`. When changing the peer protocol, keep new message fields optional (the codebase already follows this) so a minor-skewed pair degrades instead of crashing.

**One caveat for RC testing:** `/gonogo/` and `/gonogo/rc/` share an origin, so an RC station and a release station on the same device share localStorage, layout, station identity, share-code. Convenient (your station keeps its identity across channels) but an RC-channel layout experiment edits the same saved layout the release station uses.
