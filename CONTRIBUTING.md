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

[docs/KSP-SETUP.md](docs/KSP-SETUP.md) covers connecting the app to the game.

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
