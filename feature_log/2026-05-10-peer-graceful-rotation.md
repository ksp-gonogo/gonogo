# Peer graceful rotation + pre-emptive suspend cleanup

**Date:** 2026-05-10
**Validation:** pending — needs live laptop-sleep cycle with ≥1 station connected
**Commits:** [pending, not yet committed]

## Problem

Post-laptop-sleep, the host's persistent peer id (e.g. `8343`) was held as a ghost session on peerjs.com's broker. `peer.reconnect()` hit `ID is taken`. The auto-rotate guard from `e1c7d4d` deliberately refused to rotate mid-session ("manual Regenerate available"), so the host stayed wedged. The `unavailable-id` log only landed in the console — no UI surface — and the operator had to click Regenerate in the Add Station modal to recover. That forced every connected station to re-share the code.

## Fix shape

Two layers:

1. **Pre-emptive cleanup on suspend** (avoid the ghost in the first place).
   Listen for `freeze` / `resume` / `pageshow` and call `peer.disconnect()` / `peer.reconnect()` on the broker WS while keeping the underlying `RTCPeerConnection` data channels alive. Distinct from the existing `pagehide` handler which still `destroy()`s — pagehide means the page is leaving, freeze means the page is being paused. The broker gets a clean leave; the slot is released; on resume we re-register against the same id.

2. **Graceful rotation when (1) misses** (don't strand stations on the residual case).
   New peer-protocol message: `{ type: "host-id-rotation"; newPeerId; reason }`. The host broadcasts it on every live data channel, waits 500ms for flush, then `destroy()`+restarts on the new id. Stations update `hostPeerId` before the close fires; their existing retry loop reconnects to the new id without operator action. `StationScreen` subscribes and persists the new id to `gonogo-station-host-id` so a refresh during the rotation window also lands on the new code.

The `unavailable-id` recovery path now flows: `peerHasOpened === true → rotatePeerIdGracefully("unavailable-id-recovery")`. The original `e1c7d4d` concern (rotating out from under stations) is addressed by the broadcast.

## Residual edge case

Stations whose WebRTC data channels have already died before the rotation broadcast fires (long sleep, MTU change, DTLS heartbeat loss) won't receive the message and will retry the dead old id. They need a manual reconnect via QR — same UX as if the host had legitimately gone away. We accepted this trade-off; the alternative (the indirection-layer approach where share code → broker id via a lookup service) is bigger work and pulls the relay onto the critical path for station connection setup.

## Files touched

- `packages/app/src/peer/protocol.ts` — new `host-id-rotation` message variant
- `packages/app/src/peer/PeerHostService.ts` — `rotatePeerIdGracefully(reason)`, freeze/resume/pageshow handlers, updated `unavailable-id` error branch
- `packages/app/src/peer/PeerClientService.ts` — new `hostPeerIdChangeListeners`, dispatcher entry for `host-id-rotation`, public `onHostPeerIdChange(cb)`
- `packages/app/src/screens/StationScreen.tsx` — subscribe + persist new host id to localStorage + reflect in input field
- `packages/app/src/__tests__/peer-client-service.test.ts` — FakePeer captures connect target; new test verifies rotation propagates and the next reconnect targets the new id

## How to validate

1. Open the dashboard with at least one connected station. Confirm normal operation.
2. Sleep the Mac (lid close) for 30–60s, then wake. Expect:
   - Console shows `[PeerHost] page freezing — disconnecting broker (keeping live channels)` on sleep and `[PeerHost] page resuming — peer.reconnect()` on wake.
   - Station stays connected; no Regenerate banner needed.
3. To exercise rotation directly: force a broker `unavailable-id`. Hard to reproduce naturally — easiest is to open two dashboard tabs against the same persistent id, watch the second one rotate gracefully while the first stays live. Station(s) should follow without manual intervention; the share code visible in the Add Station modal should reflect the new id.

## What's NOT covered

- No UI banner for the residual "station's data channel died before rotation" case. Logged as a follow-up if/when it shows up in practice.
- No telemetry for how often the freeze/resume handlers fire (could add a `[PeerHost] freeze→resume cycle, broker re-registered after Xs` log line later).
