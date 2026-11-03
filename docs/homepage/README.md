# `ksp-gonogo.github.io`: the Gonogo home page

`index.html` in this folder is the page served at `https://ksp-gonogo.github.io/`. It has
no build step: inline CSS, one inline script (the copy buttons and the widget wall), and
the pictures in `img/`. It matches the app's dark theme.

The pictures are drawn from the current widgets and committed fixtures by

```sh
pnpm --filter @ksp-gonogo/components homepage-images
```

which renders each widget whole, at its registered default size or at a named mode where the
default is too large to read at the page's lane width, takes the
dashboard still from the README hero's composition, writes the webp files and sets each
picture's width and height in `index.html`. Commit pictures from Linux only, since fonts
rasterise differently elsewhere. `prepare-release.yml` runs it on every release, so the
release commit carries pictures of the widgets it ships; a failed render keeps the committed
pictures and warns.

On a wide screen the widgets scroll upward in three looping lanes the full height of the
window, beside the steps; with reduced motion, and on a phone, one still picture stands in.
Without JavaScript the wall shows each lane's widgets standing still.

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
`index.html` and `img/` to the root of the `ksp-gonogo/ksp-gonogo.github.io` repository each time a
release is cut, beside the release app at `/app/` and the redirects from the old
`/gonogo/...` URLs. See [the maintainer docs](https://ksp-gonogo.github.io/uplink-dev-docs/maintaining/) for the layout of that site and
which workflow owns which path.


Step 1 names SpaceDock only once Gonogo is listed there. The deploy fills the
`<!-- spacedock -->` mark in `index.html` from the `SPACEDOCK_MOD_ID_GONOGO` repository
variable, and leaves SpaceDock out while it is unset; the in-app landing page reads the same
variable at build time.