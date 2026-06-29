# Contributing to gonogo

Thanks for taking an interest. This is a small project and contributions are welcome.

## Getting set up

> This is the developer setup: run gonogo from source. The end-user, single command container setup isn't built yet, so this is also the only working way to run the main screen today.

You need **Node 24** (via nvm), **pnpm v10+**, and a container runtime (the dev tooling drives `podman compose`, so Podman is what's wired up).

gonogo depends on `@jonpepler/kerbcast`, which is published to GitHub Packages. `.npmrc` reads an auth token from `$GITHUB_TOKEN`, so you need that exported in your shell before `pnpm install`, or the install fails. The token must be exported in the same shell you run `pnpm` from; pnpm reads it from the environment, not from any saved login.

```bash
git clone https://github.com/jonpepler/gonogo.git
cd gonogo
nvm use                                # switch to Node 24 (reads .nvmrc)

# Auth for GitHub Packages. Easiest with the GitHub CLI after `gh auth login`:
export GITHUB_TOKEN=$(gh auth token)
# Or use a Personal Access Token with the read:packages scope:
# export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx

pnpm install
```

To run it, you have two choices:

```bash
# App only: just the Vite dev server. No containers needed.
# Enough for the core telemetry dashboard.
pnpm --filter @gonogo/app dev

# Full stack: also brings up the telnet-proxy and relay containers via
# `podman compose`, then runs Vite. Needed for kOS and cross-network stations.
pnpm dev
```

`pnpm dev` shells out to `podman compose up` to build and start the backend containers before it runs Vite, so it needs Podman installed. If you only want the telemetry board, the filtered app-only command is enough.

The app serves at `http://localhost:5173`. Point it at KSP by following [docs/KSP-SETUP.md](docs/KSP-SETUP.md).

## Before you push

Run all three and make sure they're clean:

```bash
pnpm test          # vitest across every package (via Turborepo)
pnpm lint          # Biome formats and lints; --write fixes in place
pnpm build         # type-check + build all packages
```

CI runs `pnpm test` on every push and pull request (`.github/workflows/ci.yml`). All tests must pass.

## How changes land

This is a solo-maintained repo, so the **maintainer commits directly to `main`**. There are no internal feature branches or self-review PRs.

**External contributors** should use the standard fork-and-PR flow:

1. Fork the repo and create a branch off `main`.
2. Make your change; run `pnpm test`, `pnpm lint`, and `pnpm build`.
3. Open a pull request with a clear description of what changed and why.

There's no required PR template; just give reviewers the context they need.

## Conventions worth knowing

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, …).
- **Tests mock as little as possible.** Prefer [Mock Service Worker](https://mswjs.io/) at the network boundary over mocking internal modules or hooks. The real data source, real hook, and real component should run, with only the network intercepted.
- **New widgets** declare both `dataRequirements` and `actions`, and ship a `jest-axe` accessibility smoke test. Interactive elements are real `<button>`/`<a>`/`<input>`; icon-only buttons get an `aria-label`.
- **New data sources** must register a `PerfBudget` (sample-rate or dispatch-rate). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#performance-budgets).
- **Reusable UI primitives** go in `@gonogo/ui`, not co-located with the first widget that needs them.

For the package map and the extension API, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
