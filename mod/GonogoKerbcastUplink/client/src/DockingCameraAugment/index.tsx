// kerbcast docking-camera augment for DistanceToTarget.
//
// Fills DistanceToTarget's `distance-to-target.camera` slot with a live video
// backdrop behind the docking reticle. This is the filler that widget's
// augment-slot doc block was written for: the slot was previously only
// EXPOSED, with a built-in `HudCamera` holding the spot "until the kerbcast
// filler and CameraFeed-out-migration land". That built-in has now been
// removed — see this module's sibling note in `DistanceToTarget/index.tsx`.
//
// Why an augment and not a standalone CameraFeed instance: the backdrop has to
// draw in the HUD's own reticle space and share its lifecycle. The slot passes
// `DistanceToTargetHudContext` for exactly that, and `requires: "kerbcast"`
// means an install without the kerbcast mod composes the HUD without any video
// layer at all — rather than the core client shipping a camera path it can
// never light up.
//
// Presence-gated on `kerbcast.available`; camera CHOICE comes off the Uplink's
// `kerbcast.cameras` control channel (`isDockingCamera`), while the MEDIA still
// rides kerbcast's own WebRTC path (`useDelayedKerbcastStream`, which delays it
// on the shared ViewClock). That split is the whole design: control plane on
// the Uplink, media off it.

import type {} from "@ksp-gonogo/components"; // pulls DistanceToTarget's "distance-to-target.camera" SlotRegistry merge into this program (see that module's declare-module comment)
import type { SlotProps } from "@ksp-gonogo/core";
import {
  getUplinkHandle,
  registerAugment,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  KerbcastProvider,
  type KerbcastSubscriptions,
} from "@ksp-gonogo/kerbcast-react";
import { useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import { useDelayedKerbcastStream } from "../CameraFeed/useDelayedKerbcastStream";
import type { KerbcastDataSource } from "../KerbcastDataSource";
import { selectDockingCamera } from "./selectDockingCamera";

export function DockingCameraAugment({
  cameraFlightId,
}: SlotProps<"distance-to-target.camera">) {
  const cameras = useTelemetry("kerbcast.cameras");
  const flightId = selectDockingCamera(cameras, cameraFlightId);
  const ds = getUplinkHandle<KerbcastDataSource>("kerbcast");
  const client = ds?.getClient();

  // Kick the MEDIA connection once the CONTROL plane names a camera to show.
  // Necessary because the two planes are separate: the built-in HudCamera this
  // augment replaced read its list via `useKerbcastCameras`, which calls
  // `ensureConnected()` as a side effect, so the connect came for free. Reading
  // the list off the Uplink topic instead means nothing else would open the
  // WebRTC session — `useKerbcastStream`'s `subscribeCamera` only binds a slot
  // when the source is ALREADY connected, and never initiates. Without this a
  // brokered station stalls exactly the way `useKerbcastCameras`' own comment
  // describes: a camera is named, but no session is ever opened for it.
  // No-op once connected (e.g. the main screen, or a CameraFeed already up).
  useEffect(() => {
    if (flightId === null) return;
    ds?.ensureConnected();
  }, [flightId, ds]);

  // The DELAYED backdrop needs the mission-time capture clock (`useKerbcastClock`,
  // read by `useDelayedKerbcastStream`), which lives on a `KerbcastProvider` —
  // exactly the provider `CameraFeed` mounts for its own feed. Mounting our own,
  // fed the SAME `ds.getClient()` client, is what lets this backdrop and a
  // `CameraFeed` on the same camera share ONE delayed pipeline: the shared cache
  // in `useDelayedPlayout` keys on the raw `MediaStream`, and both providers
  // resolve the identical stream object off the one data source. Kept in the
  // inner `DockingCameraVideo` so the OUTER component (which subscribes to the
  // control channel above) never depends on the provider — a no-kerbcast HUD
  // still composes.
  const subscriptions: KerbcastSubscriptions | undefined = useMemo(
    () =>
      ds
        ? {
            acquire: ds.subscribeCamera.bind(ds),
            release: ds.unsubscribeCamera.bind(ds),
          }
        : undefined,
    [ds],
  );

  if (flightId === null || !client || !subscriptions) return null;
  return (
    <KerbcastProvider client={client} subscriptions={subscriptions}>
      <DockingCameraVideo flightId={flightId} />
    </KerbcastProvider>
  );
}

function DockingCameraVideo({ flightId }: { flightId: number }) {
  // The DELAYED stream, not the raw live one. The HUD's reticle is UT-gated by
  // the ViewClock; the backdrop must be gated on the SAME clock or it marks
  // where the target WAS over an image of where it IS — worst precisely when
  // closing on a docking port (decision 5: never the live stream). `null` (no
  // delayed output available) draws no backdrop rather than falling back to
  // live.
  const stream = useDelayedKerbcastStream(flightId);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) {
      // play() can reject when srcObject is reassigned mid-flight — benign.
      void v.play().catch(() => {});
    }
  }, [stream]);

  if (!stream) return null;
  return <HudVideo ref={videoRef} autoPlay muted playsInline />;
}

registerAugment({
  id: "kerbcast-docking-camera",
  augments: "distance-to-target.camera",
  requires: "kerbcast",
  channels: ["kerbcast.cameras"],
  component: DockingCameraAugment,
});

export { selectDockingCamera };

// Matches the `HudVideo` the built-in `HudCamera` rendered, so the backdrop
// lands identically: absolutely positioned over the HudPanel (AugmentSlot
// renders a bare fragment, so this <video> is a direct HudPanel child, exactly
// where the built-in sat), under the Viewport's tinted reticle layer.
const HudVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.55;
`;
