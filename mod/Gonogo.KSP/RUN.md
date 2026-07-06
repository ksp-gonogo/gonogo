# Gonogo mod — first run & data capture

## What this is
A telemetry mod that streams KSP data over a delayed WebSocket, and — for now —
RECORDS everything it sees (data + scene changes) to a file so we can replay your
session headlessly. This first build serves the "System View" slice (celestial
bodies) and captures a full session.

## Install
Nothing to do manually. The mod DLLs are deployed into your syncthing-mirrored
KSP install (`GameData/Gonogo/Plugins/`). Once syncthing has synced, KSP loads it
automatically on launch. To confirm it's there, `GameData/Gonogo/Plugins/` should
contain:

- `Gonogo.dll`
- `Sitrep.Contract.dll`
- `Sitrep.Core.dll`
- `Sitrep.Host.dll`
- `Sitrep.Transport.dll`

## Capture a session (the important bit — capture broadly)
1. Launch KSP.
2. From the MAIN MENU, load a save (any save — System View isn't vessel-dependent).
3. Let it sit a moment so body data flows.
4. Flip through a scene or two (e.g. into the Tracking Station / VAB and back).
5. Do a QUICKLOAD (F9) — this exercises the timeline-rewind case.
6. Quit.

A minute or two total is plenty. The mod records the whole session (data + every
scene transition) to:

```
<KSP>/GameData/Gonogo/PluginData/recordings/session-<yyyyMMdd-HHmmss>.json
```

(written on quit / addon teardown — timestamp is UTC).

## Send it back
Send me that recording file. That single capture lets me iterate the entire
slice — mod pipeline + the System View widget — headlessly, with no more game
restarts needed from you.

## (Optional) watch it live
The mod serves `ws://0.0.0.0:8090` (all interfaces) — reachable from another
device on the LAN at `ws://<this-KSP-machine-LAN-IP>:8090`. Connect any WS
client and send:

```json
{"type":"subscribe","topic":"system.bodies"}
```

## Notes
- `ws://` only (no TLS) — bound to `0.0.0.0` (all LAN interfaces), matching how
  Telemachus binds. The read-only telemetry is thus exposed to your local
  network; fine on a home LAN. (The bind is still hard-coded for this first build.)
- If KSP fails to load the mod, grab `KSP.log` (repo root of your KSP install) and
  send it — the first-run KSP-assembly/Mono load is the one genuine unknown we're
  validating.
