# Connecting gonogo to KSP

gonogo reads your game through mods installed in KSP. This page lists the mods you need, how to install them, how to point the dashboard at your running game, and how to check that telemetry is actually arriving.

## The mods you need

One mod is required:

- **The Gonogo mod**, listed on CKAN as **Gonogo** (identifier `GonogoCore`). This is how gonogo reads the game: telemetry, career state, science, comms and more, streamed live over one WebSocket on port **8090**. See [Installing the Gonogo mod](#installing-the-gonogo-mod)

Everything else is optional, and each one adds widgets without touching the rest of the dashboard:

- **[kOS](https://ksp-kos.github.io/KOS/)** and the **GonogoKosUplink** mod that connects it, for the kOS Terminal widget (see [kOS](#kos))
- **[SCANsat](https://github.com/S-C-A-N/SCANsat)** and the **GonogoScansatUplink** mod, for the map and scanning widgets
- **[Kerbcast](https://github.com/ksp-gonogo/kerbcast)** and the **GonogoKerbcastUplink** mod, for streaming and controlling cameras, with **[HullcamVDS Continued](https://spacedock.info/mod/885/HullcamVDS%20Continued)** for the in-game camera parts (see [Camera feeds](#camera-feeds-kerbcast))

An Uplink is a small mod that connects gonogo to one other mod. Each lists the Gonogo mod as its dependency, so a mod manager that finds them installs the Gonogo mod first. Without kerbcast you get no camera feeds, without kOS no terminal, and so on. Start with the Gonogo mod, confirm telemetry is arriving, then add whichever of the others you want.

To see every Uplink CKAN lists, type `dep:GonogoCore` into its search box. kOS and SCANsat are on CKAN too, and HullcamVDS Continued is on SpaceDock. Kerbcast and any Uplink CKAN does not list are hand installs, walked through below.

### Where your KSP install is

Every install step below copies files into `GameData/` inside your KSP install, so find it first.

- **Steam**: right-click Kerbal Space Program in your library, Manage, Browse local files
- Otherwise it is wherever you unpacked the game

Inside it you will see a `GameData/` folder already containing `Squad/`. That is the folder mods go in.

**"Merging a mod's `GameData/`"** means: copy the folders *inside* the mod's `GameData/` into *your* `GameData/`, so you end up with `GameData/Squad/` and `GameData/Gonogo/` side by side. You are never replacing your `GameData/` folder, and no two mods share a folder name, so nothing gets overwritten. Reinstalling a mod means deleting its folder and copying the new one in, not merging on top of the old.

## Installing the Gonogo mod

The easiest install is CKAN, a mod manager for KSP: [install CKAN](https://github.com/KSP-CKAN/CKAN/wiki/Installing-CKAN) by following its own guide, search it for **Gonogo**, tick it and press Apply. CKAN puts `GameData/Gonogo/` in place and keeps it updated.

Without CKAN, download `Gonogo-<version>.zip` from the [releases page](https://github.com/ksp-gonogo/gonogo/releases), unzip it and merge its `GameData/` folder into your KSP install's `GameData/`, as described under [Where your KSP install is](#where-your-ksp-install-is).

> **Not on CKAN yet?** The CKAN listing and the downloadable zip arrive with the first release that carries them, and until then neither exists. If a search for **Gonogo** finds nothing, or the releases page has no `Gonogo-<version>.zip`, there is nothing to install yet: come back after the first release.

### Starting KSP

The mod loads before the main menu and stays loaded across every scene change, so the server is up the moment KSP boots and a dashboard can connect to it from the main menu. Channel data starts flowing once a save is loaded. You do not need to be in a flight scene.

**It listens on `ws://0.0.0.0:8090`**, meaning every network interface, so there is nothing to change on the KSP side to reach it from another computer. The bind address and port are compiled in; there is no setting for either.

There is no TLS and no password, and the same socket that serves telemetry also accepts commands that act on your game. Anything that can reach port 8090 on that machine can fly your ship. Keep it to a network you trust, and don't forward the port.

That includes playing with someone who isn't on your network: they don't need this port, and shouldn't have it. A remote crewmate opens the hosted app and joins with the share code your main screen shows, and their commands travel over that link and are dispatched by your machine. Forwarding 8090 to the internet would hand anyone who found it the same control, with nothing to stop them.

### Installing Uplinks

An Uplink is one mod's worth of extra telemetry and widgets, and it comes in two halves: a plugin that goes in `GameData/` beside the Gonogo mod, and a client bundle that ships with the gonogo app itself. You install the plugin half; the app fetches its own half. Install the Uplink from CKAN (search `dep:GonogoCore`), which also installs the Gonogo mod it depends on. Install kOS (or SCANsat) itself first.

If CKAN does not list an Uplink yet, there is no download for it yet either: it arrives with its first release. Uplinks are optional and independent. A missing one costs you its widgets and nothing else.

## Connecting the dashboard to KSP

Everything the app needs to know about your game is one **Host**: a single address shared by the telemetry stream, the camera feeds and every Uplink. Ports are fixed per service, so you never set more than the host.

It is the **browser** you opened the main screen in that connects to the game, directly, on port 8090 for the mod. The container does not. So the Host is an address the main screen computer's browser can reach, and the firewall that matters is the KSP computer's, which must accept incoming connections on 8090 (and 8088 for cameras).

The default is `localhost`, so if you are running the container bundle with `KSP_HOST` set (see the root [README](../README.md#how-to-run-it)) or KSP is on the same computer, there is nothing to do. Note that running both on one computer is awkward in practice, because KSP pauses when it isn't the focused window; [NETWORKING.md](NETWORKING.md) explains the two-computer setup and how to find the KSP computer's address.

To set or change the host by hand:

1. On the main screen, hover the **+** button in the bottom-right corner, or Tab to it. A tower of buttons expands above it, each with its name beside it
2. Press the **Settings** button (the gear)
3. Open the **Connection** tab
4. Under **Game host**, the row is named **Telemetry stream**. Press the gear on that row to reveal **Host** and **Port**, set Host to the KSP computer's address, and press **Save**

The change takes effect immediately, with no restart and no page reload. Port defaults to `8090` and there is normally no reason to touch it.

On a brand new browser this same connection row is part of a six-step setup that opens by itself once (Welcome, Start the container, Connect to KSP, Uplinks, Health check, Done), checking each part for you. **The Connect to KSP step is where a player whose game is on a second computer types that computer's address**: press the gear on its row and set Host. You can open the setup again from **Settings, Connection, Run setup again**.

Station screens need none of this. A station gets all its data from the main screen over a peer connection and never talks to KSP.

## Checking telemetry is arriving

Three checks, cheapest first. Do them in order: each one tells you which half of the path is broken.

### 1. Did the mod start?

Open `KSP.log` in your KSP install folder and search for `[Gonogo]`. A working start logs:

```
[Gonogo] Started - serving system.bodies + <n> vessel.* channels on ws://0.0.0.0:8090
```

- **No `[Gonogo]` lines at all**: KSP never loaded the mod. Check `GameData/Gonogo/Plugins/` exists and holds every DLL the mod shipped with, none deleted
- **`[Gonogo] Failed to start:`**: the exception that follows says why. A port already in use is the usual cause

### 2. Does the app say it is connected?

Open **Settings, Connection** as above. The **Telemetry stream** row shows a status word next to its name:

- **CONNECTED**: the browser has an open socket to the mod. Expect this from the main menu, before any save is loaded. The connection is fine; if widgets are still empty, load a save
- **DISCONNECTED**: nothing is getting through. The row also grows a **Reconnect** button and a line of setup text
- **ERROR** or **RECONNECTING**: the socket failed or is retrying, same causes as disconnected

When the connection is down, the Settings button in the FAB tower carries an orange dot, so you can see it without opening anything.

If the mod started (check 1 passed) but the app says disconnected, the problem is between the two machines: a wrong Host, or a firewall on the KSP computer. Windows and macOS both block incoming local-network connections by default; [NETWORKING.md](NETWORKING.md) covers this.

The **Uplinks** tab beside it has a page for every Uplink the mod reports installed, showing the health the Uplink reports for itself and whether the app loaded its client, with the reason when it refused one. The list comes off the live stream, so an empty **Uplinks** tab is itself a sign that nothing is arriving.

### 3. Does a widget draw?

Load any save in KSP, then press the **+** button in the bottom-right of the dashboard and add **System View**. It draws a diagram of the bodies orbiting a chosen parent, fed by the `system.bodies` channel, which is the channel that asks least of your save: no vessel and no flight scene, just a loaded game.

If System View draws bodies, telemetry is arriving and you are done. Fly something and the vessel widgets follow.

## kOS

The kOS Terminal widget needs two mods in KSP: **[kOS](https://ksp-kos.github.io/KOS/)** itself, and **GonogoKosUplink**, which is what lets gonogo talk to it (both installed above).

There is no separate bridge process, no proxy to start and no second port. kOS rides the same WebSocket on 8090 as everything else: the app dispatches a script over the stream and reads the result back off it. So there is no kOS host to configure, and no kOS entry on the Connection tab; setting the one **Host** above is the whole of the setup.

The widget lists the CPUs the mod reports. With no CPU reaching it, for any reason, it reads *"No kOS CPUs detected. Boot a kOS processor in-flight."* That one message covers a kOS processor you haven't switched on, GonogoKosUplink not being installed, and no telemetry stream at all, so work down the three checks above before assuming it is a kOS problem. The rest of the dashboard is unaffected either way, and **Settings, Uplinks** is where kOS's own health is reported.

## Camera feeds (kerbcast)

Live in-game camera feeds come through **kerbcast**, a separate KSP-side camera-streaming mod.

### Installing kerbcast

1. Download the latest `kerbcast-v<version>.zip` from the releases page: **<https://github.com/ksp-gonogo/kerbcast/releases/>**. Take the full `kerbcast-v<version>.zip`, not the bare `Kerbcast.dll`.
2. Unzip it and merge its `GameData/` folder into your KSP install's `GameData/`, as described under [Where your KSP install is](#where-your-ksp-install-is).
3. kerbcast uses the camera parts from **HullcamVDS Continued** (in the mod list above), so make sure that's installed too.

By default kerbcast only accepts connections from the same computer, unlike the Gonogo mod, which listens on every interface. To watch feeds from another device, which is the usual setup with the dashboard on a different machine from KSP, create `GameData/Kerbcast/PluginData/settings.cfg` (the folder and file are yours to make) containing a `Settings` block with `BindAddress` set to the KSP computer's LAN address (or `0.0.0.0` for every interface), for example `Settings { BindAddress = 0.0.0.0 }`. The `settings.cfg` next to it is overwritten on every update, which is why the change goes in `PluginData`. There's no password on the stream, so only open it up on a network you trust.

Restart KSP. kerbcast starts automatically when a flight scene loads; there's nothing else to run. It serves on port **8088**.

### Connecting the dashboard

There is nothing to configure. The browser on the main screen computer dials kerbcast at the same **Host** you already set for the telemetry stream, on its own port 8088, so there is no camera row on the Connection tab and no second address to keep in sync.

In gonogo, press **+** and add the **Camera Feed** widget. Camera feeds follow the same CommNet rule as the rest of the data: they cut out when you lose the connection.
