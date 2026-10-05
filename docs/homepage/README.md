# `ksp-gonogo.github.io`: the Gonogo home page

`index.html` in this folder is the page served at `https://ksp-gonogo.github.io/`. It is
self-contained (no build step, inline CSS and one inline script for the copy buttons) and
matches the app's dark theme.

It is the first half of setup, the half that happens before a local app exists: start the
container, install the mod through CKAN, open `http://localhost:8080`. The second half is
the setup that opens by itself in the local app and checks each part. Nothing on this page
checks anything, because an `https://` page cannot reach `http://localhost` or a KSP
install (mixed content).

It says the same thing as the in-app `HostedLanding`, which is what `/app/` shows when it
is opened over HTTPS. `packages/app/src/firstRun/setupGuide.test.ts` fails if the run
command printed here drifts from the one the app prints.

## How it gets published

Nothing in this folder is deployed by hand. `deploy.yml`'s release channel copies
`index.html` to the root of the `ksp-gonogo/ksp-gonogo.github.io` repository each time a
release is cut, beside the release app at `/app/` and the redirects from the old
`/gonogo/...` URLs. See [DEPLOYMENT.md](../DEPLOYMENT.md) for the layout of that site and
which workflow owns which path.
