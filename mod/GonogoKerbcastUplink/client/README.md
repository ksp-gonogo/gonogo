# @ksp-gonogo/kerbcast-feed

The client half of the **GonogoKerbcastUplink**, living beside the C# mod it
ships with. Consumer of the [kerbcast](https://github.com/jonpepler/kerbcast)
KSP camera-streaming sidecar.

The npm name is `@ksp-gonogo/kerbcast-feed`, not `@ksp-gonogo/kerbcast` — that
one is the external kerbcast protocol SDK this package depends on from public
npm.

On module import it registers:

- a `kerbcast` **DataSource** — the sidecar connection
- a `camera-feed` **widget** — placeable from the dashboard picker
- a `kerbcast-docking-camera` **augment** — fills DistanceToTarget's
  `distance-to-target.camera` slot with the close-range docking-camera
  backdrop, picking the camera off the Uplink's `isDockingCamera` fact.
  Presence-gated on `kerbcast.available`, so an install without kerbcast
  composes that HUD with no video layer and no cost.

Wire it into the app once, alongside the other data-source imports:

```ts
// packages/app/src/dataSources/index.ts
import "@ksp-gonogo/kerbcast-feed";
```

After that, "Kerbcast" appears in the Data Sources widget (with the
sidecar host/port configurable from the same UI) and "Camera Feed"
appears in the dashboard widget picker.

## Which plane rides where

Camera **control** (inventory, capabilities, docking-port association, zoom/pan)
rides the Uplink's Topics like any other Uplink. Camera **video** does not ride
Topics at all — it stays on kerbcast's own WebRTC path, because a keyframed
telemetry channel is the wrong shape for encoded media. The two planes join on
`cameraId` === kerbcast's `flightId`.

## Shape

```
KerbcastConnection      WebRTC peer + kerbcast-control data channel
                       (transport-abstracted so unit tests don't
                       need a real RTCPeerConnection)

KerbcastDataSource      gonogo DataSource wrapping the connection;
                       surfaces in the Data Sources widget

useKerbcastCameras()    live CameraState[] from the sidecar's
                       camera-snapshot / camera-state-changed pushes

useKerbcastStream(id)   live MediaStream for one camera

CameraFeed             dashboard widget rendering a single camera's
                       stream; auto-picks the first available live
                       camera when no flightId is configured
```

Wire-protocol types come from `@jonpepler/kerbcast` (the typeshare-
generated TS bindings published from the sidecar's Rust types).

## Status

v0.0.1 — minimal cut. Widget connects to the sidecar, renders a
single camera at a time, no operator controls yet (use the bundled
test page at `http://<sidecar-host>:8088/` for layer / FoV /
render-size toggles in the meantime). Per-camera controls in the
widget itself are the next iteration.
