# Visual preview loop (CI-faithful diffs before you touch baselines)

When a widget's appearance changes, the CI `visual` gate diffs each render
against its committed per-engine baseline and fails on drift. Before you accept
that drift (regenerate baselines), you want to **see** the diffs, and see them
rendered the way CI renders them, not with your local OS's fonts. A macOS-local
gate run is pure font noise: every widget "drifts" against the Linux baselines.

`scripts/visual-preview.sh` runs the existing `visual-gate` inside the exact
Linux image CI uses (`mcr.microsoft.com/playwright:v<pinned>-noble`, matching the
lockfile's `playwright` version), so the diffs are faithful.

## The loop

```
# 1. PREVIEW: see what drifted, faithfully. Prints host paths to
#    baseline / actual / diff PNGs; exits 0 (drift is the signal, not a failure).
pnpm visual-preview --engine chromium              # all widgets
pnpm visual-preview --engine chromium --widget landing-status   # one widget

# 2. SHARE the diff PNGs, get an explicit OK.

# 3. UPDATE: write Linux-faithful, committable baselines (same image):
pnpm visual-preview --engine chromium --update [--widget <id>]
```

Repeat per engine (`chromium` / `firefox` / `webkit`), the gate is per-engine.
Updated baselines land in `packages/components/visual-baselines/<engine>/` on the
host, ready to commit. (This is the local equivalent of
`gh workflow run update-baselines.yml`; use whichever fits.)

## Prereqs

- **podman** (default `/opt/podman/bin/podman`; override with `$PODMAN`).
- **`~/.npmrc`**: mounted read-only for registry auth. `pnpm install` pulls
  `@ksp-gonogo/kerbcast*` from npm; `~/.npmrc` carries the `@ksp-gonogo`
  registry routing + token. Anyone who's run `pnpm install` locally already has
  it. (If those packages ever move to GitHub Packages, `~/.npmrc` would need a
  GitHub token instead.)

## Notes

- **Font-baked image.** The stock `playwright:noble` image is font-minimal, so
  text-heavy widgets drift against CI's baselines (the gate embeds JetBrains
  Mono, but text still falls back to system fonts for `°`/`↓`/`→`/`·`/`Δ` and
  fontconfig hinting). `scripts/visual-preview.Containerfile` derives an image
  with ubuntu-latest's font set on top of the base; the script builds it once
  (cached by tag `localhost/gonogo-visual-preview:pw<ver>`) so text renders
  faithfully. Bump the fonts / rebuild if a widget uses a new glyph range.
- The container does its own Linux `pnpm install` into **named volumes** (the
  host's `node_modules` are macOS-native and can't be reused). First run is slow
  (image build + full install); named volumes make re-runs fast. Your host
  `node_modules` are never touched, each is shadowed by a volume.
- Diff PNGs land at `local_docs/renders/_visual-gate-diffs/<engine>/<widget>/`
  (gitignored) on the host. **The gate clears that dir at the START of each run**;
  Read/copy a run's diffs before launching the next one.
- Keep the `PLAYWRIGHT_VERSION` in the script in lock-step with the lockfile's
  resolved `playwright` (= CI). If an UNCHANGED widget shows drift in preview,
  the image tag no longer matches CI's rasterisation, fix the tag.
