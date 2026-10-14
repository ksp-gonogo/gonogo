# Gonogo mod: install and session recording

## What this is
A telemetry mod that streams KSP data over a delayed WebSocket, and records
everything it sees (data and scene changes) to a file, so a session can be
replayed headlessly.

## Install
Copy the mod's `Gonogo` folder into your KSP install's `GameData/`. KSP loads it
automatically on launch. To confirm it's there, `GameData/Gonogo/Plugins/`
should contain:

- `Gonogo.dll`
- `Sitrep.Contract.dll`
- `Sitrep.Core.dll`
- `Sitrep.Host.dll`
- `Sitrep.Transport.dll`

## Record a session
Capture broadly: the recording is most useful when it covers several scenes.
1. Launch KSP.
2. From the MAIN MENU, load a save.
3. Let it sit a moment so body data flows.
4. Flip through a scene or two (e.g. into the Tracking Station / VAB and back).
5. Do a QUICKLOAD (F9), this exercises the timeline-rewind case.
6. Quit.

A minute or two total is plenty. The mod records the whole session (data and
every scene transition) to:

```
<KSP>/GameData/Gonogo/PluginData/recordings/session-<yyyyMMdd-HHmmss>.json
```

(written on quit / addon teardown: timestamp is UTC). A recording replays the
whole mod pipeline headlessly, with no game restarts.

## Watch it live
The mod serves `ws://0.0.0.0:8090` (all interfaces): reachable from another
device on the LAN at `ws://<this-KSP-machine-LAN-IP>:8090`. Connect any WS
client and send:

```json
{"type":"subscribe","topic":"trackingStation.bodies"}
```

## Notes
- `ws://` only (no TLS): bound to `0.0.0.0` (all LAN interfaces). The read-only
  telemetry is thus exposed to your local network; fine on a home LAN. The bind
  is hard-coded.
- If KSP fails to load the mod, check `KSP.log` (in the root of your KSP
  install) for the assembly-load error.
