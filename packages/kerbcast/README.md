# @gonogo/kerbcast

Consumer of the [kerbcast](https://github.com/jonpepler/kerbcast) KSP
camera-streaming sidecar for gonogo. Registers a `kerbcast` DataSource
and a `camera-feed` dashboard widget on module import.

Wire it into the app once, alongside the other data-source imports:

```ts
// packages/app/src/dataSources/index.ts
import "@gonogo/kerbcast";
```

After that, "Kerbcast" appears in the Data Sources widget (with the
sidecar host/port configurable from the same UI) and "Camera Feed"
appears in the dashboard widget picker.

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
