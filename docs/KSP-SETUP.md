# Connecting gonogo to KSP

gonogo reads your game through mods installed in KSP. This page lists the mods you need, how to install them, and how to point the dashboard at your running game.

## The mods you need

Install all of these:

- **The Gonogo mod** (hand install, below). This is how gonogo reads the game — telemetry, career state, science, comms, and more, streamed live over a WebSocket
- **[kOS](https://ksp-kos.github.io/KOS/)** for the kOS Terminal widget and the kOS-driven widgets
- **[SCANsat](https://github.com/S-C-A-N/SCANsat)** for the map and scanning widgets
- **[HullcamVDS Continued](https://spacedock.info/mod/885/HullcamVDS%20Continued)** for in-game cameras
- **[Kerbcast](https://github.com/jonpepler/kerbcast)** for streaming and controlling the cameras

kOS and SCANsat are on CKAN. The Gonogo mod and kerbcast are hand installs; both are walked through below. Everything except the camera feeds works without kerbcast, so you can leave it for last, or skip it, if you like.

## Installing the Gonogo mod

> **Not released yet.** The Gonogo mod (`GameData/Gonogo/`, engineering codename "Sitrep") isn't on CKAN or SpaceDock, and there's no downloadable `GameData.zip` release yet — the publish pipeline (`.github/workflows/publish-mods.yml`) is built but still inert pending some upstream prerequisites. Until a release ships, this is a build-from-source step for anyone working in this repo; see `mod/Gonogo.KSP/RUN.md`. This section will get a straight download link once that lands.

Once installed and KSP is running, it starts a WebSocket server on port **8090** automatically — you don't need to be in a flight scene, the main menu is enough.

## Connecting the dashboard to KSP

The Sitrep stream connects on its own, no setup needed, if KSP runs on the same computer as gonogo — it defaults to `localhost:8090`.

If KSP runs on a different computer, open **Settings → Data Sources → Sitrep Stream** (the database icon in the bottom-right **+** menu) and set Host to the KSP computer's address (Port defaults to `8090`). This takes effect immediately, no restart needed. [NETWORKING.md](NETWORKING.md) walks through finding the KSP computer's address for a two-computer setup.

Running the Docker bundle (see the root [README](../README.md#how-to-run-it))? `KSP_HOST` seeds this automatically, same as kOS and the camera feed — you only need the Settings panel to override it.

Building the app from source instead and want the default baked in rather than set per-browser? `VITE_SITREP_HOST`/`VITE_SITREP_PORT` in `packages/app/.env.local` (gitignored — see [CONTRIBUTING.md](../CONTRIBUTING.md#getting-set-up)) set the build-time floor that the Settings panel and `KSP_HOST` both override.

## kOS

The kOS Terminal and the kOS-driven widgets need **[kOS](https://ksp-kos.github.io/KOS/)** installed in KSP. gonogo reaches kOS through a small bridge that's part of the gonogo setup; everything else works without it. If the bridge isn't running, the kOS Terminal widget shows a connection error and the rest of the dashboard is unaffected.

Configure it from the **Data Sources** panel (the database button in the bottom-right **+** menu) by opening the `kos` data source and setting the kOS host to the KSP computer's address (the kOS default port is `5410`). kOS-driven widgets run scripts on your active CPU and share the results with every widget that wants them, running each script once no matter how many widgets subscribe.

## Camera feeds (kerbcast)

Live in-game camera feeds come through **kerbcast**, a separate KSP-side camera-streaming mod.

### Installing kerbcast

1. Download the latest `kerbcast-<version>.zip` from the releases page: **<https://github.com/jonpepler/kerbcast/releases/>**. Take the full `kerbcast-<version>.zip`, not the bare `Kerbcast.dll`.
2. Unzip it and merge its `GameData/` folder into your `Kerbal Space Program/GameData/` folder, the same way as the Gonogo mod above.
3. kerbcast uses the camera parts from **HullcamVDS Continued** (in the mod list above), so make sure that's installed too.

By default kerbcast only accepts connections from the same computer. To watch feeds from another device, which is the usual setup with the dashboard on a different machine from KSP, open `GameData/Kerbcast/settings.cfg` and change `BindAddress = 127.0.0.1` to the KSP computer's LAN address (or `0.0.0.0` for every interface). There's no password on the stream, so only open it up on a network you trust.

Restart KSP. kerbcast starts automatically when a flight scene loads; there's nothing else to run. It serves on port **8088**.

### Connecting the dashboard

In gonogo, add the **Camera Feed** widget, then open the **Data Sources** panel (the database icon in the bottom-right **+** menu) and point the camera source at the KSP computer's address and port `8088`. Camera feeds follow the same CommNet rule as the rest of the data: they cut out when you lose the connection.
