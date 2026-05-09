# GonogoTelemetry — KSP plugin

A KSP mod that adds gonogo-specific telemetry keys (tech tree, contracts, building shops, launchpad state) on top of [Telemachus Reborn](https://github.com/TeleIO/Telemachus-1). Registers as an external plugin via Telemachus's `IMinimalTelemachusPlugin` interface — no Telemachus fork required.

## Status

**Phase 1 — proof of pipeline.** Ships two keys that prove the registration works end-to-end:

- `tech.unlockedIds` — array of researched tech-tree node ids
- `tech.unlockedPartCount` — number of parts available under current tech

See `local_docs/telemachus_extension_plan.md` in the repo root for the full roadmap (science detail, contracts, building shops, launchpad, write-paths).

## Build

Requires .NET Framework 4.7.2 SDK (or `mono` / `dotnet` with the netfx 4.7.2 reference packs).

```bash
cd mod/GonogoTelemetry
dotnet build -c Release
```

The csproj references KSP / Unity assemblies from `local_docs/telemachus-fork/references/` and the built Telemachus DLL from `local_docs/telemachus-fork/publish/GameData/Telemachus/Plugins/Telemachus.dll`. Build Telemachus first if you haven't:

```bash
cd local_docs/telemachus-fork/Telemachus
dotnet build -c Release
```

## Install into KSP

1. Build Telemachus (above) and install it normally — copy `local_docs/telemachus-fork/publish/GameData/Telemachus/` into `<KSP>/GameData/`.
2. Build this mod (above) and copy the output:

   ```bash
   mkdir -p <KSP>/GameData/GonogoTelemetry/Plugins
   cp bin/Release/net472/GonogoTelemetry.dll <KSP>/GameData/GonogoTelemetry/Plugins/
   ```

3. Launch KSP. Check `<KSP>/Logs/KSP.log` (or the in-game console) for the line:

   ```
   [GonogoTelemetry] Registered with Telemachus.
   ```

## Verify it works

Open `http://<KSP-host>:8085/telemachus/datalink?tech.unlockedIds=tech.unlockedIds` in a browser. Should return JSON like:

```json
{ "tech.unlockedIds": ["start", "basicRocketry", "engineering101"] }
```

Or in gonogo's WS feed, subscribe to `tech.unlockedIds` from the Data Source widget — value lands as an array.

## Adding a new key

1. Add the key to the `Commands` array in `TechTreeApi.cs` (or a new file alongside it).
2. Add a `case "..."` branch in `GetAPIHandler` returning a delegate of the form `(vessel, args) => value`.
3. Rebuild + reinstall.

For non-tech keys (contracts, science instruments, etc.), follow the same pattern in a new class implementing `IMinimalTelemachusPlugin` and register it from `GonogoTelemetryAddon.Awake`.

## Why a separate plugin and not a Telemachus fork

Telemachus exposes `PluginRegistration.Register(this)` for exactly this purpose. Going via the public extension API means:

- Telemachus updates don't require us to merge upstream every time.
- A user without gonogo can still install vanilla Telemachus.
- We can iterate on gonogo-specific telemetry on our own cadence.

The trade-off is write paths (contract accept, tech node unlock) — Telemachus's action verb model is `?a=actionKey`, no parameters. For Phase 4 we either upstream a parameterised action endpoint to Telemachus or ship our own HTTP route in this plugin. Decision pending.
