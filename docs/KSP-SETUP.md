# Connecting gonogo to KSP

gonogo reads your game through mods installed in KSP. This page lists the mods you need, how to install them, how to point the dashboard at your running game, and how to check that telemetry is actually arriving.

## The mods you need

Install all of these:

- **The Gonogo mod** (build-and-copy install, below). This is how gonogo reads the game, telemetry, career state, science, comms, and more, streamed live over one WebSocket on port **8090**
- **[kOS](https://ksp-kos.github.io/KOS/)** for the kOS Terminal widget, plus the **GonogoKosUplink** mod that connects the two (see [kOS](#kos) below)
- **[SCANsat](https://github.com/S-C-A-N/SCANsat)** for the map and scanning widgets, plus the **GonogoScansatUplink** mod
- **[HullcamVDS Continued](https://spacedock.info/mod/885/HullcamVDS%20Continued)** for in-game camera parts
- **[Kerbcast](https://github.com/jonpepler/kerbcast)** for streaming and controlling the cameras

kOS and SCANsat are on CKAN; HullcamVDS Continued is on SpaceDock. The Gonogo mod, the two `Gonogo*Uplink` mods and kerbcast are hand installs, all walked through below.

Only the Gonogo mod is required. Everything else adds widgets: without kerbcast you get no camera feeds, without kOS no terminal, and the rest of the dashboard is unaffected. Start with the Gonogo mod, confirm telemetry is arriving, then add the others.

### Where your KSP install is

Every install step below copies files into `GameData/` inside your KSP install, so find it first.

- **Steam**: right-click Kerbal Space Program in your library, Manage, Browse local files
- Otherwise it is wherever you unpacked the game

Inside it you will see a `GameData/` folder already containing `Squad/`. That is the folder mods go in.

**"Merging a mod's `GameData/`"** means: copy the folders *inside* the mod's `GameData/` into *your* `GameData/`, so you end up with `GameData/Squad/` and `GameData/Gonogo/` side by side. You are never replacing your `GameData/` folder, and no two mods share a folder name, so nothing gets overwritten. Reinstalling a mod means deleting its folder and copying the new one in, not merging on top of the old.

## Installing the Gonogo mod

> **Not released yet.** The Gonogo mod isn't on CKAN or SpaceDock, and there is no downloadable zip. The publish pipeline (`.github/workflows/publish-mods.yml`) builds the mod zips already, but the SpaceDock upload needs a per-mod repository variable that has not been set, so nothing has been published anywhere. Until that lands, the only install is a build from source. It needs [the .NET SDK](https://dotnet.microsoft.com/download) (10.x, which is what CI builds with) and takes about five minutes. This section will get a straight download link once a release ships.

### 1. Find KSP's managed assemblies

The mod compiles against KSP's own assemblies, which are not redistributable, so you point the build at the copy inside your own install. In your KSP folder, find the directory holding `Assembly-CSharp.dll`:

- **Windows / Linux**: `KSP_x64_Data/Managed`
- **macOS**: `KSP.app/Contents/Resources/Data/Managed`

Note that path; the next step needs it.

### 2. Build

```bash
git clone https://github.com/ksp-gonogo/gonogo.git
cd gonogo
dotnet build mod/Gonogo.KSP/Gonogo.KSP.csproj -c Release \
  -p:KspManaged="/path/to/KSP_x64_Data/Managed"
```

It prints a lot of nullable-reference warnings and should finish with `0 Error(s)`.

### 3. Copy the build into GameData

Create `GameData/Gonogo/Plugins/` in your KSP install and copy **every** `.dll` from `mod/Gonogo.KSP/bin/Release/` into it. There are six:

```
GameData/Gonogo/Plugins/Gonogo.dll
GameData/Gonogo/Plugins/Sitrep.Contract.dll
GameData/Gonogo/Plugins/Sitrep.Core.dll
GameData/Gonogo/Plugins/Sitrep.Host.dll
GameData/Gonogo/Plugins/Sitrep.Propagation.dll
GameData/Gonogo/Plugins/Sitrep.Transport.dll
```

Copy all six. That set is the mod's runtime closure, and KSP fails to load the mod if one is missing. The `.pdb` files next to them are debug symbols and are not needed.

### 4. Start KSP

The mod loads before the main menu and stays loaded across every scene change, so the server is up the moment KSP boots and a dashboard can connect to it from the main menu. Channel data starts flowing once a save is loaded. You do not need to be in a flight scene.

**It listens on `ws://0.0.0.0:8090`**, meaning every network interface, so there is nothing to change on the KSP side to reach it from another computer. The bind address and port are compiled in; there is no setting for either.

There is no TLS and no password, and the same socket that serves telemetry also accepts commands that act on your game. Anything that can reach port 8090 on that machine can fly your ship. Keep it to a network you trust, and don't forward the port.

### Installing the kOS and SCANsat Uplinks

An Uplink is one mod's worth of extra telemetry and widgets, and it comes in two halves: a plugin that goes in `GameData/` beside the Gonogo mod, and a client bundle that ships with the gonogo app itself. You install the plugin half; the app fetches its own half.

Each plugin builds the same way as the Gonogo mod, with one extra argument pointing at your `GameData/` so it can link against the mod it extends:

```bash
dotnet build mod/GonogoKosUplink/GonogoKosUplink.csproj -c Release \
  -p:KspManaged="/path/to/KSP_x64_Data/Managed" \
  -p:KspGameData="/path/to/Kerbal Space Program/GameData"
```

Then copy every `.dll` from `mod/GonogoKosUplink/bin/Release/` into `GameData/GonogoKosUplink/Plugins/`. SCANsat is identical with `GonogoScansatUplink` in place of `GonogoKosUplink` everywhere. Install kOS (or SCANsat) itself first: the build links against it and fails without it.

Uplinks are optional and independent. A missing one costs you its widgets and nothing else.

## Connecting the dashboard to KSP

Everything the app needs to know about your game is one **Host**: a single address shared by the telemetry stream, the camera feeds and every Uplink. Ports are fixed per service, so you never set more than the host.

The default is `localhost`, so if you are running the container bundle with `KSP_HOST` set (see the root [README](../README.md#how-to-run-it)) or KSP is on the same computer, there is nothing to do. Note that running both on one computer is awkward in practice, because KSP pauses when it isn't the focused window; [NETWORKING.md](NETWORKING.md) explains the two-computer setup and how to find the KSP computer's address.

To set or change the host by hand:

1. On the main screen, hover the **+** button in the bottom-right corner. A tower of buttons expands above it, each with its name beside it
2. Press the **Settings** button (the gear)
3. Open the **Data Sources** tab
4. Under **Game host**, the row is named **Telemetry stream**. Press the gear on that row to reveal **Host** and **Port**, set Host to the KSP computer's address, and press **Save**

The change takes effect immediately, with no restart and no page reload. Port defaults to `8090` and there is normally no reason to touch it.

On a brand new browser this same connection panel opens by itself as the first step of a short setup flow, so you may meet it before you go looking for it. It only ever opens once.

Building the app from source and want the default baked in rather than set per-browser? `VITE_SITREP_HOST`/`VITE_SITREP_PORT` in `packages/app/.env.local` (gitignored; see [CONTRIBUTING.md](../CONTRIBUTING.md#getting-set-up)) set the build-time floor that both the Settings panel and `KSP_HOST` override.

Station screens need none of this. A station gets all its data from the main screen over a peer connection and never talks to KSP.

## Checking telemetry is arriving

Three checks, cheapest first. Do them in order: each one tells you which half of the path is broken.

### 1. Did the mod start?

Open `KSP.log` in your KSP install folder and search for `[Gonogo]`. A working start logs:

```
[Gonogo] Started - serving system.bodies + <n> vessel.* channels on ws://0.0.0.0:8090
```

- **No `[Gonogo]` lines at all**: KSP never loaded the mod. Check `GameData/Gonogo/Plugins/` has all six DLLs
- **`[Gonogo] Failed to start:`**: the exception that follows says why. A port already in use is the usual cause

### 2. Does the app say it is connected?

Open **Settings, Data Sources** as above. The **Telemetry stream** row shows a status word next to its name:

- **CONNECTED**: the browser has an open socket to the mod. Expect this from the main menu, before any save is loaded. The connection is fine; if widgets are still empty, load a save
- **DISCONNECTED**: nothing is getting through. The row also grows a **Reconnect** button and a line of setup text
- **ERROR** or **RECONNECTING**: the socket failed or is retrying, same causes as disconnected

When the connection is down, the Settings button in the FAB tower carries an orange dot, so you can see it without opening anything.

If the mod started (check 1 passed) but the app says disconnected, the problem is between the two machines: a wrong Host, or a firewall on the KSP computer. Windows and macOS both block incoming local-network connections by default; [NETWORKING.md](NETWORKING.md) covers this.

Below the connection row, **Uplink health** lists every Uplink the mod reports installed, and **Loaded clients** lists the client bundles the app loaded or refused, each refusal with its reason. Both lists come off the live stream, so an empty **Uplink health** list is itself a sign that nothing is arriving.

### 3. Does a widget draw?

Load any save in KSP, then press the **+** button in the bottom-right of the dashboard and add **System View**. It draws a diagram of the bodies orbiting a chosen parent, fed by the `system.bodies` channel, which is the channel that asks least of your save: no vessel and no flight scene, just a loaded game.

If System View draws bodies, telemetry is arriving and you are done. Fly something and the vessel widgets follow.

## kOS

The kOS Terminal widget needs two mods in KSP: **[kOS](https://ksp-kos.github.io/KOS/)** itself, and **GonogoKosUplink**, which is what lets gonogo talk to it (both installed above).

There is no separate bridge process, no proxy to start and no second port. kOS rides the same WebSocket on 8090 as everything else: the app dispatches a script over the stream and reads the result back off it. So there is no kOS host to configure, and no kOS entry in the Data Sources panel; setting the one **Host** above is the whole of the setup.

The widget lists the CPUs the mod reports. With no CPU reaching it, for any reason, it reads *"No kOS CPUs detected. Boot a kOS processor in-flight."* That one message covers a kOS processor you haven't switched on, GonogoKosUplink not being installed, and no telemetry stream at all, so work down the three checks above before assuming it is a kOS problem. The rest of the dashboard is unaffected either way, and **Settings, Data Sources, Uplink health** is where kOS's own health is reported.

## Camera feeds (kerbcast)

Live in-game camera feeds come through **kerbcast**, a separate KSP-side camera-streaming mod.

### Installing kerbcast

1. Download the latest `kerbcast-<version>.zip` from the releases page: **<https://github.com/jonpepler/kerbcast/releases/>**. Take the full `kerbcast-<version>.zip`, not the bare `Kerbcast.dll`.
2. Unzip it and merge its `GameData/` folder into your KSP install's `GameData/`, as described under [Where your KSP install is](#where-your-ksp-install-is).
3. kerbcast uses the camera parts from **HullcamVDS Continued** (in the mod list above), so make sure that's installed too.

By default kerbcast only accepts connections from the same computer, unlike the Gonogo mod, which listens on every interface. To watch feeds from another device, which is the usual setup with the dashboard on a different machine from KSP, open `GameData/Kerbcast/settings.cfg` and change `BindAddress = 127.0.0.1` to the KSP computer's LAN address (or `0.0.0.0` for every interface). There's no password on the stream, so only open it up on a network you trust.

Restart KSP. kerbcast starts automatically when a flight scene loads; there's nothing else to run. It serves on port **8088**.

### Connecting the dashboard

There is nothing to configure. kerbcast is dialled at the same **Host** you already set for the telemetry stream, on its own port 8088, so there is no camera row in the Data Sources panel and no second address to keep in sync.

In gonogo, press **+** and add the **Camera Feed** widget. Camera feeds follow the same CommNet rule as the rest of the data: they cut out when you lose the connection.
