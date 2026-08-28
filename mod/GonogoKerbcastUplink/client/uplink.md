Puts live in-flight camera views on the dashboard, fed by
[kerbcast](https://github.com/jonpepler/kerbcast), the KSP camera-streaming
sidecar. Cameras come from Hullcam VDS parts on the flying vessel, with a picker
and Next/Previous switching in the widget, and crew faces can be shown in the
CrewStatus avatars.

## Two planes, and only one of them rides the Uplink

Camera CONTROL rides the Uplink like any other: the inventory, each camera's
capabilities, its docking-port association, health, and the aim and zoom
commands. Camera VIDEO does not ride it at all, and that split is deliberate. A
keyframed telemetry channel is the wrong shape for encoded media, so video stays
on kerbcast's own WebRTC path. The two planes join on the camera id, which is
kerbcast's own flight id for the same part.

The practical consequence is that a camera can be listed and controllable while
its video is not up, and the widget distinguishes the two rather than showing one
blank rectangle for both.

The mod half never links kerbcast's assembly and never derives from its types.
Every member is reached by runtime reflection, which keeps this assembly clear of
kerbcast's NonCommercial ShareAlike terms; its attribution notice ships beside
the plugin in `NOTICE-KERBCAST.txt`.

## Install

Needs the kerbcast sidecar running and reachable, and Hullcam VDS parts on the
vessel you want to see. The sidecar's host and port are configurable from the
Data Sources panel. With no sidecar the Uplink loads and the widget says it has
no cameras rather than showing a dead frame.

## augment:kerbcast-docking-camera

Fills Targeting's camera slot with the close-range docking view, choosing the
camera from the Uplink's own docking-port association rather than asking the
operator which lens is pointing at the port.

Presence-gated, so an install without kerbcast composes that HUD with no video
layer and no cost, rather than reserving space for a picture that is never
coming.
