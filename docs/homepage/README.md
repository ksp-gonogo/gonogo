# `ksp-gonogo.github.io` — the Gonogo home page

The Gonogo app deploys as a **project page** at `https://ksp-gonogo.github.io/gonogo/`
(built + published by `.github/workflows/deploy.yml`, Vite base `/gonogo/`). GitHub only
serves an **organisation** site (`https://ksp-gonogo.github.io/`, no `/gonogo/` suffix)
from a repo literally named `ksp-gonogo.github.io`. So making the org root the Gonogo
front door needs that one extra repo — it can't come from this repo's Pages.

`index.html` in this folder is a ready-to-serve, self-contained front door (no build step,
inline CSS, matches the app's dark/accent theme). It mirrors the in-app `HostedLanding`
and links straight into the app + station + GitHub.

## Recommended: org-root landing that links into the app (lowest risk)

Keep the app where it is (`/gonogo/`) and let the org root be a static front door.

```sh
# One-time, run by a ksp-gonogo org owner (creates a PUBLIC repo — your call):
gh repo create ksp-gonogo/ksp-gonogo.github.io --public \
  --description "Gonogo — mission control for Kerbal Space Program"

tmp=$(mktemp -d) && cd "$tmp" && git init -b main
cp /path/to/gonogo/docs/homepage/index.html .
git add index.html && git commit -m "feat: Gonogo org front door"
git remote add origin https://github.com/ksp-gonogo/ksp-gonogo.github.io.git
git push -u origin main
```

Then in the new repo: **Settings → Pages → Source = Deploy from a branch → `main` / root**.
Within a minute `https://ksp-gonogo.github.io/` serves the landing, and its buttons go to
`https://ksp-gonogo.github.io/gonogo/` (app) and `.../gonogo/station`.

## Alternative: serve the app itself at the org root

Heavier — point `deploy.yml` at the `ksp-gonogo.github.io` repo and rebuild with
`VITE_BASE_PATH=/` (every asset/route path changes, and the deploy needs cross-repo
write permission). Only worth it if you want the full app, not a landing, at the root.
Not done here — flag if that's what you want.

## Why this part isn't automated

Creating a public org repo and changing Pages settings are account/infra actions that
belong to you, not an autonomous agent. Everything else — the landing asset and the
`jonpepler → ksp-gonogo` rename across the app, docs, netkans, and image/URL refs — is
already done on this branch. The deploy workflows derive the owner from
`${{ github.repository_owner }}`, so image pushes + Pages already target `ksp-gonogo`
automatically once merged.
