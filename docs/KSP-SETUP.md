# Connecting gonogo to KSP

gonogo reads your game through mods installed in KSP. This page lists the mods you need, how to install them, and how to point the dashboard at your running game.

## The mods you need

Install all of these:

- **The gonogo build of Telemachus** (hand install, below). This is how gonogo reads the game and sends it commands. Stock or CKAN Telemachus won't do; it has to be the gonogo build
- **[kOS](https://ksp-kos.github.io/KOS/)** for the kOS Terminal widget and the kOS-driven widgets
- **[SCANsat](https://github.com/S-C-A-N/SCANsat)** for the map and scanning widgets
- **[HullcamVDS Continued](https://spacedock.info/mod/885/HullcamVDS%20Continued)** for in-game cameras
- **[Kerbcam](https://github.com/jonpepler/kerbcam)** for streaming and controlling the cameras

kOS and SCANsat are on CKAN. The gonogo Telemachus build and kerbcam are hand installs; both are walked through below. Everything except the camera feeds works without kerbcam, so you can leave it for last, or skip it, if you like.

## Installing the gonogo build of Telemachus

gonogo uses its own build of Telemachus rather than the stock or CKAN release. The gonogo build carries extra data that gonogo needs: career, science, strategies, SCANsat, and landing telemetry. Those aren't in the upstream release yet. The plan is to fold what makes sense back upstream, but for now you install the gonogo build directly.

1. Download the latest `GameData.zip` from the releases page: **<https://github.com/jonpepler/Telemachus-1/releases/>**
2. Unzip it and merge its `GameData/` folder into your `Kerbal Space Program/GameData/` folder.
3. Restart KSP and load a flight scene.

Telemachus starts a server on port **8085**. gonogo connects to it for live data and for control actions.

## Connecting the dashboard to KSP

With KSP and the main screen on separate computers (see [NETWORKING.md](NETWORKING.md)) and a vessel on the launchpad or in flight:

1. In gonogo, hover the **+** button (bottom-right) and click the **Data Sources** button (the database icon) to open the Data Sources panel.
2. Next to the **data** row (Telemachus), click the gear icon.
3. Set **host** to the KSP computer's address on your network and **port** to `8085`, then save.
4. Click **Reconnect**. The indicator turns green and telemetry starts flowing.

[NETWORKING.md](NETWORKING.md) walks through finding the KSP computer's address.

## Letting gonogo read action responses (CORS)

To allow Telemachus to respond to gonogo's commands, you have to edit the Telemachus config.

Tell Telemachus which address you open gonogo at. After your first KSP launch with Telemachus installed, edit `GameData/Telemachus/Plugins/PluginData/Telemachus/config.xml` and add this line inside the `<config>` element, replacing the address with the one you actually open gonogo at:

```xml
<string name="ALLOWED_ORIGINS">http://localhost:8080</string>
```

If you open gonogo at more than one address, list them comma-separated with no spaces and no trailing slash. Restart KSP afterwards; the file is read once when the plugin starts.

## kOS

The kOS Terminal and the kOS-driven widgets need **[kOS](https://ksp-kos.github.io/KOS/)** installed in KSP. gonogo reaches kOS through a small bridge that's part of the gonogo setup; everything else works without it. If the bridge isn't running, the kOS Terminal widget shows a connection error and the rest of the dashboard is unaffected.

Configure it from the **Data Sources** panel (the database button in the bottom-right **+** menu) by opening the `kos` data source and setting the kOS host to the KSP computer's address (the kOS default port is `5410`). kOS-driven widgets run scripts on your active CPU and share the results with every widget that wants them, running each script once no matter how many widgets subscribe.

## Camera feeds (kerbcam)

Live in-game camera feeds come through **kerbcam**, a separate KSP-side camera-streaming mod.

### Installing kerbcam

1. Download the latest `kerbcam-<version>.zip` from the releases page: **<https://github.com/jonpepler/kerbcam/releases/>**. Take the full `kerbcam-<version>.zip`, not the bare `Kerbcam.dll`.
2. Unzip it and merge its `GameData/` folder into your `Kerbal Space Program/GameData/` folder, the same way as Telemachus above.
3. kerbcam uses the camera parts from **HullcamVDS Continued** (in the mod list above), so make sure that's installed too.

By default kerbcam only accepts connections from the same computer. To watch feeds from another device, which is the usual setup with the dashboard on a different machine from KSP, open `GameData/Kerbcam/settings.cfg` and change `BindAddress = 127.0.0.1` to the KSP computer's LAN address (or `0.0.0.0` for every interface). There's no password on the stream, so only open it up on a network you trust.

Restart KSP. kerbcam starts automatically when a flight scene loads; there's nothing else to run. It serves on port **8088**.

### Connecting the dashboard

In gonogo, add the **Camera Feed** widget, then open the **Data Sources** panel (the database icon in the bottom-right **+** menu) and point the camera source at the KSP computer's address and port `8088`. Camera feeds follow the same CommNet rule as the rest of the data: they cut out when you lose the connection.
