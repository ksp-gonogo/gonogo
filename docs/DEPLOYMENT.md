# Deployment (maintainer reference)

This page is for whoever maintains the deployed gonogo. Day-to-day use runs locally; see the [README](../README.md).

## Frontend (GitHub Pages)

> **Where the work goes.** Day-to-day work lands on `staging`, which deploys nothing by itself. The release-candidate channel is built from `staging` by `rc.yml`, nightly and on demand; `main` moves only when a release is cut. The remote default branch is `main`, on purpose: it is the real latest version, what a new visitor sees. See Release and RC channels below.

The site is [ksp-gonogo.github.io](https://ksp-gonogo.github.io/), served by GitHub Pages from the `main` branch of the `ksp-gonogo/ksp-gonogo.github.io` repository. That repository is a deploy target and is never edited by hand. It holds several tenants, each at its own path:

| Path | What | Written by |
| --- | --- | --- |
| `/` | the landing page, `docs/homepage/index.html` | `deploy.yml`, release channel |
| `/app/` (stations: `/app/station`) | the latest release of the app | `deploy.yml`, release channel |
| `/rc/` (stations: `/rc/station`) | the release-candidate app | `deploy.yml`, rc channel |
| `/gonogo/...` | redirects from the old project-page URLs, keeping the query string and hash | `deploy.yml`, release channel |
| `README.md` (in the repository, not on the site) | one link to this repository, written once and then kept | `deploy.yml`, release channel |

The Uplink developer docs at `ksp-gonogo.github.io/uplink-dev-docs/` are not in that repository: GitHub serves that path from the `uplink-dev-docs` repository's own Pages, and nothing here writes under it.

The workflow is `.github/workflows/deploy.yml`, called by `rc.yml` with `channel=rc` and dispatched by `release.yml` with `channel=release`; nothing triggers it on a push. A run checks the site repository out, writes its own channel's paths with `scripts/pages-compose.mjs`, and commits exactly those paths, so an RC cannot disturb the release. The one shared file is the empty `/.nojekyll` marker, which either channel creates when it is missing: the site builds with legacy Jekyll, which would otherwise drop the underscore-named files a Vite build emits and render the README onto the site. See Release and RC channels below.

> The hosted page can't run the **main screen**. The main screen needs to reach your KSP install over a plain `ws://` connection, which a browser blocks from an `https://` page (mixed content), so the main screen always runs locally against your own KSP. What the hosted page is for is **station** screens: a station on someone else's network loads the app from here and joins with the share code.

Requirements:

- The `PAGES_DEPLOY_TOKEN` secret: a fine-grained personal access token with **Contents: read and write** on `ksp-gonogo/ksp-gonogo.github.io` and nothing else. `deploy.yml` fails on its first step when it is missing.
- In `ksp-gonogo/ksp-gonogo.github.io`, Pages source is **Deploy from a branch**, `main` at `/`. This repository's own Pages is off: while it is on, GitHub serves `ksp-gonogo.github.io/gonogo/` from here and the redirects in the site repository are never reached.
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
| Pages site | `ksp-gonogo.github.io/app/`, with the landing page at the root | `ksp-gonogo.github.io/rc/` (stations: `/rc/station`) |
| Bundle image | `ghcr.io/ksp-gonogo/gonogo:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo:rc` |
| Relay image | `ghcr.io/ksp-gonogo/gonogo-relay:<version>` + `:latest` | `ghcr.io/ksp-gonogo/gonogo-relay:rc` |
| Mod GameData zips | attached to the GitHub Release, and pushed to SpaceDock | built and kept as a CI artifact only (`rc-<shortsha>`) |
| npm packages | `sitrep-sdk` / `ui-kit` / `uplink-tools`, all at `X.Y.Z` | not by `rc.yml`; an opt-in package RC (below) publishes `X.Y.Z-rc.<run>` under the `rc` dist-tag |
| NuGet package | `KspGonogo.Sitrep.Contract` at `X.Y.Z` | not by `rc.yml` (CI packs, gates and probes it); the opt-in package RC publishes `X.Y.Z-rc.<run>` |
| App version | `X.Y.Z` | `X.Y.Z-rc.<shortsha>` |

Both images also carry a `sha-<commit>` tag in both channels. `gonogo` and `gonogo-relay` are the only two images; there is no third service image. The earlier dev channel (`/gonogo/dev/`, `:dev`) is gone, while old `:dev` image tags linger on GHCR.

**How an RC is built.** `rc.yml` checks out `staging` and acts on its head sha:

- it does nothing when `rc-<shortsha>` already exists. That tag is the record of the last RC: it is written only after Pages, images and mod zips all finished, so a failed RC leaves none and the next night retries. The `force` input rebuilds a sha that already has a tag
- it does nothing when the head is a release commit (a `v*` tag points at it)
- it validates the sha before anything publishes. If every CI run of it on `ci-dev` is green (`scripts/ci-dev-forward-verdict.sh`, the forwarder's own rule) the tests are not repeated and the gate passes. Otherwise (no `ci-dev` run, one pending or red, the list unreadable) it calls `ci.yml` against the sha and publishes only if that passes. `ci.yml` is callable (`workflow_call`, `ref` input, every checkout takes it). `staging` gets no CI of its own from the forwarder (a `GITHUB_TOKEN` push starts no workflow), which is why the `ci-dev` run is the usual evidence. `force` bypasses neither. On the called path, a `schedule` or `workflow_dispatch` run has no push `before`, so the shrink-only ratchets grade against `HEAD^` (the last commit only)
- it calls `deploy.yml`, `publish-images.yml` and `publish-mods.yml` with that sha

```bash
gh workflow run rc.yml --ref staging              # build the RC now
gh workflow run rc.yml --ref staging -f force=true
```

**Why `rc.yml` is one self-contained file.** `schedule` runs the copy of a workflow on the default branch, `main`, which moves only at a release. So `rc.yml` is the same file on both branches and behaves by where it runs: a scheduled run is a trampoline that only dispatches `rc.yml` with `--ref staging` and exits, and every real job runs only when `github.ref` is `refs/heads/staging`, using staging's own `ci.yml` and publishers. Only `rc.yml` has to reach `main` for the nightly to start.

**Cutting a release.** One dispatch, on `staging`:

```bash
gh workflow run prepare-release.yml --ref staging
gh workflow run prepare-release.yml --ref staging -f version=X.Y.Z   # an exact version: a reset of the line, or a 1.0
```

`prepare-release.yml` refuses any other ref, and refuses when `main` has commits `staging` lacks (it cannot be fast-forwarded), printing how many. Otherwise it commits the version bump on top of `staging`, which fast-forwards `main` to it, returns the commit to `staging`, and puts it on `ci-dev` too (fast-forward, or a merge commit when `ci-dev` holds work `staging` has not received), so `ci-dev` stays a superset of `staging` and `ci-dev-forward.yml` keeps fast-forwarding. Then it carries on as below.

The `bump` input accepts `auto` (the default), `patch`, `minor` or `major`; force one with `-f bump=minor`. `auto` analyses conventional commits since the last `v*` tag (an `rc-*` tag is not a release), `feat:` → minor, `BREAKING CHANGE`/`!` → major, anything else → patch, and fails the run outright when that range is empty rather than re-cutting an already-released tree. Override it whenever `auto` would understate the change: the bump size *is* the wire-compatibility promise in the skew table below, and `auto` only reads commit subjects. The `version` input replaces the bump with an exact `X.Y.Z`. Whichever way it is chosen, `scripts/release-packages.mjs` refuses the version unless it sorts above every version any published package has on npm or nuget.org and its `v*` tag does not exist yet: a version is spent once, for everything.

**One version for everything.** The release version is `packages/app/package.json`'s, and it is also the version of every published package: `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit` and `@ksp-gonogo/uplink-tools` on npm and `KspGonogo.Sitrep.Contract` on nuget.org. The release commit moves the three npm manifests with the app's (`scripts/freeze-published-surface.mjs --release`), the NuGet csproj reads the app's manifest, and every packed npm manifest pins its siblings to the same version exactly. The wire contract's `Major.Minor` and `EXTENSION_API_VERSION` are not package versions: they are compatibility stamps the host checks at load and move by their own rules. The contract one is stamped on `Sitrep.Contract.dll` as `SitrepContractVersion` metadata, and the package gate checks it in the packed file.

**What a release moves.** `prepare-release.yml` freezes the published surface ledgers, moves the app and every published package to the release version, commits `release: vX.Y.Z`, tags, pushes the commit and the tag to `main`, returns the release commit to `staging` (so `main` can still be fast-forwarded next time), then dispatches `release.yml` on the tag. `release.yml` runs the full test suite at the tag, and then:

- uploads the production site as the GitHub Release asset `gonogo-site.tar.gz`, and marks that release GitHub's latest explicitly (`/app/` serves whichever release is latest, and GitHub's automatic choice would keep an older higher-numbered one),
- dispatches `publish-images.yml` with `channel=release`, tagging `gonogo` and `gonogo-relay` `:<version>` + `:latest`,
- dispatches `publish-mods.yml` with `channel=release`, attaching each mod GameData zip in that workflow's matrix to the Release and pushing it to SpaceDock (a mod whose `vars.SPACEDOCK_MOD_ID_*` repo variable is unset warns and skips the SpaceDock half instead of failing),
- dispatches `deploy.yml` with `channel=release`, which publishes that asset at `/app/` along with the landing page and the old-URL redirects,
- publishes `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit` and `@ksp-gonogo/uplink-tools` to npm at the release version, refusing a manifest that is not at it. A version already on npm (a re-run attempt) is skipped, but the skip is checked against the published tarball, so content that moved under a published version fails instead of going quiet.
- publishes `KspGonogo.Sitrep.Contract` to nuget.org at the release version. The `publish-nuget` job packs once with both determinism flags set, gates that file, builds `GonogoProbeUplink` (`scripts/nuget-probe-uplink/`, kept here only to be probed) against it outside the repo (plus a planted gap that must fail), and pushes the same file. When the version IS already on nuget.org (a re-run attempt), it downloads that published copy and compares it against the fresh pack with the build-identity regions (PE timestamp, debug-directory timestamps, PDB id, PDB checksum, module MVID) normalised out; a real difference fails rather than skipping silently. It authenticates through nuget.org trusted publishing, bound to `release.yml` with no environment, and needs the `NUGET_USER` secret: the nuget.org profile name that owns the policy. There is no API key.

**The packages are published as a set.** A release and a candidate both go in this order, and no tag anyone installs by moves until the end: the NuGet package is pushed and the run waits until nuget.org lists it (up to 45 minutes); each npm package is published under the `pending` dist-tag; each is read back from the registry; then one job moves `rc` or `latest` for all three together. A failure anywhere leaves every tag naming the previous set and the run red; run the workflow again to finish it. Moving a tag needs "Allow npm dist-tag" ticked on each package's trusted publisher on npmjs.com. To check that without moving a real tag: `gh workflow run release.yml --ref staging -f rc=true -f dry_run=true -f tag_probe=true`.

**Package release candidates.** Packages get RCs only on demand, from `staging`, through the same `release.yml` that publishes them for real (npm's trusted publishers and nuget.org's policy name that file):

```bash
gh workflow run release.yml --ref staging -f rc=true -f dry_run=true   # everything but the login and the push
gh workflow run release.yml --ref staging -f rc=true                   # publish the RCs
gh workflow run release.yml --ref staging -f rc=true -f version=X.Y.Z  # RCs of an exact release, not the auto bump
```

`rc=true` skips the app release (no tag, no GitHub Release, no images, no Pages) and refuses any ref but `refs/heads/staging`. It commits nothing, bumps nothing in the repo and never freezes a surface ledger. Its `rc-plan` job works out the RC with `scripts/release-packages.mjs plan` and proves the set:

- the RC is a prerelease of the NEXT release, worked out exactly as `prepare-release.yml` would (or the `version` input), and refused on the same rule. The suffix is `-rc.<workflow run number>`, unique per run and increasing, and all four packages carry the same one. When an RC was cut for an exact `version`, give `prepare-release.yml` the same one
- each npm manifest pins every `@ksp-gonogo` sibling to that RC exactly. `ui-kit` and `uplink-tools` import the sdk without declaring it (a workspace peer breaks the workspace's own resolution), so the stamp declares that edge as an exact peer, at a release as well as an RC
- a package that has never been published gets the RC as its first version: npm may make that first version `latest` whatever the tag, and the job summary says where `latest` points afterwards
- `published-packages-probe.mjs --version <rc>` installs the three stamped tarballs together outside the workspace, so a pin that does not resolve fails before anything publishes

Then `publish-packages` packs each package exactly as a release does, stamps the RC onto the tarball, runs `verify-package-artifact.mjs` and `release-packages.mjs check` on that file, publishes it with `--tag rc` and fails if npm's `latest` moved for a package that already had one. `publish-nuget` packs with `-p:PackageVersion=<RC>` (the assemblies keep their contract stamp), runs the package gate with `--rc`, the extraction probe and its planted gap, and pushes only an `-rc.` version. A re-run attempt keeps its run number, so a package an earlier attempt published is skipped, and the fossil check compares that copy as it does for a release. The matrix does not fail fast, so a run where one package failed leaves its siblings' exact pins unresolvable until that job is re-run.

An outside author installs them together with `npm install @ksp-gonogo/sitrep-sdk@rc @ksp-gonogo/ui-kit@rc @ksp-gonogo/uplink-tools@rc` (the pins are exact, so an RC beside a release of a sibling fails peer resolution), or a NuGet `PackageReference` with the exact `-rc.<n>` version.

The version in `packages/app/package.json`, and with it every published package's, only ever changes through this flow. Never hand-edit any of them in either direction: `release.yml` refuses a tag that disagrees with the app's version and a package manifest that disagrees with the tag, so an edit breaks the next release rather than undoing the last one.

The release commit is pushed with `GITHUB_TOKEN`, and token pushes do not fire workflow triggers, so **CI never runs on the release commit**, and therefore `rc.yml` builds no RC for it either. Each publisher is dispatched by `release.yml` explicitly, in the order above; there is no second Pages run racing the release.

**How the Pages site holds both channels:** each channel is its own `deploy.yml` run writing its own directory. The rc channel builds the app (base `/rc/`, `-rc.<shortsha>` suffix) from the commit it is given and replaces `/rc/`. The release channel downloads the newest release's `gonogo-site.tar.gz` (built by `release.yml` with base `/app/`), replaces `/app/` with it, and rewrites the landing page and the redirects from the commit it runs on. Neither reads or removes the other's directory, so a release leaves the RC exactly as the last RC run left it. A site asset built before the move to `/app/` cannot be served from there, and the release channel refuses one.

**Checking a release landed.** A release fans out into three further workflow runs, so `release.yml` going green is not the whole answer:

```bash
gh run list --limit 10                                     # release.yml plus what it dispatched
gh release view v<X.Y.Z> --json assets --jq '.assets[].name'

curl -s https://ksp-gonogo.github.io/app/ | grep gonogo-version
curl -s https://ksp-gonogo.github.io/rc/  | grep gonogo-version
```

Every build stamps `<meta name="gonogo-version">` and `<meta name="gonogo-build-time">` into the page shell for exactly this, so both channels can be read without dev-tools. The same string is baked into the JS as `__GONOGO_VERSION__` and announced in the peer `hello` handshake. For the images, `podman pull ghcr.io/ksp-gonogo/gonogo:<version>` proves the tag exists, and a running relay answers `GET /version`.

**Rolling back.** There is no undo command, and the sanctioned move is forward: fix, and cut the next release. If `/app/` has to serve the previous release *now*, demote the bad one and publish again, because `/app/` follows whatever GitHub calls the latest release and a pre-release is not it. This only reaches back as far as the first release built for `/app/`: an older site asset was built for `/gonogo/` and the release channel refuses it.

```bash
gh release edit v<bad> --prerelease
gh workflow run deploy.yml --ref main -f channel=release           # /app/ falls back to the previous release asset
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

**One caveat for RC testing:** `/app/` and `/rc/` share an origin, so an RC station and a release station on the same device share localStorage, layout, station identity, share-code. Convenient (your station keeps its identity across channels) but an RC-channel layout experiment edits the same saved layout the release station uses.
