import type { CrewLocation } from "@ksp-gonogo/kerbcast";
import { CrewLocation as CrewLocationEnum } from "@ksp-gonogo/kerbcast";
import {
  KerbalFaceFeed,
  KerbcastProvider,
  type KerbcastSubscriptions,
  useKerbcastClient,
  useKerbcastSubscriptions,
} from "@ksp-gonogo/kerbcast-react";
import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import {
  getUplinkHandle,
  registerAugment,
  useSetting,
} from "@ksp-gonogo/sitrep-sdk";
import { TextButton, useModal } from "@ksp-gonogo/ui";
import { Badge } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { useKerbcastCameras } from "../hooks/useKerbcastCameras";
import type { KerbcastDataSource } from "../KerbcastDataSource";
import { selectKerbalCamera } from "./selectKerbalCamera";

/**
 * kerbcast crew-avatar augment: fills CrewStatus's `crew-status.avatar`
 * slot (facecam-stage6 consumption design) with a live per-kerbal face,
 * layering an EVA/IVA badge and a click-to-spotlight modal over kerbcast-
 * react's shared `KerbalFaceFeed` primitive.
 *
 * Two gates, both zero-cost when off/absent:
 *  - `requires: "kerbcast"` (below), the augment doesn't mount at all
 *    without the Uplink present; `<AugmentSlot>` enforces this.
 *  - the "kerbcast.embeddedFacecams" kill-switch (design item g): a
 *    COMPONENT-BOUNDARY split: OFF returns before the subscribing child
 *    mounts, so no facecam stream is ever requested.
 *
 * `selectKerbalCamera` correlates CrewStatus's name-keyed roster row
 * against kerbcast's `kind: Kerbal` cameras by `cameraName` (see that
 * module's doc: name is the only identity stable across seat<->EVA and the
 * only one both sides carry). When no camera matches, kerbcast absent, this
 * kerbal not seated, embedded facecams off: the augment renders nothing,
 * and CrewStatus itself renders no leading avatar cell at all for that row
 * (no decorative fallback dot; see `avatarAugmentPresent` in
 * `CrewStatus/index.tsx`).
 */
export function KerbcastAvatarAugment({
  crewName,
}: SlotProps<"crew-status.avatar">) {
  const [embedded] = useSetting<boolean>("kerbcast.embeddedFacecams", true);
  if (!embedded) return null;
  return <FacecamAvatar crewName={crewName} />;
}

function FacecamAvatar({ crewName }: { crewName: string }) {
  const cameras = useKerbcastCameras();
  const camera = selectKerbalCamera(cameras, crewName);
  const ds = getUplinkHandle<KerbcastDataSource>("kerbcast");
  const client = ds?.getClient();

  // Kick the MEDIA connection once a face camera is known for this kerbal.
  // Mirrors DockingCameraAugment: the camera registry is populated by the
  // control-channel handshake, but `subscribeCamera`/`useKerbcastStream`
  // only bind a slot on an ALREADY-connected source, without this a
  // brokered station never opens a session for a kerbal it can already see
  // in the registry.
  useEffect(() => {
    if (!camera) return;
    ds?.ensureConnected();
  }, [camera, ds]);

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

  if (!camera || !client || !subscriptions) return null;
  return (
    <KerbcastProvider client={client} subscriptions={subscriptions}>
      <FacecamAvatarFeed
        flightId={camera.flightId}
        crewName={crewName}
        crewLocation={camera.crewLocation}
      />
    </KerbcastProvider>
  );
}

function FacecamAvatarFeed({
  flightId,
  crewName,
  crewLocation,
}: {
  flightId: number;
  crewName: string;
  crewLocation?: CrewLocation;
}) {
  const { open } = useModal();
  const isEva = crewLocation === CrewLocationEnum.Eva;
  // `useModal`'s dialog renders through a `createPortal` mounted at the
  // `ModalProvider` call site: OUTSIDE this component's own
  // `KerbcastProvider` ancestor. React context resolves by render-tree
  // position, not by where the JSX was constructed, so the spotlight's
  // `KerbalFaceFeed` needs its OWN provider, fed the same client/subscriptions
  // this feed already has (mirrors DockingCameraAugment's own inner
  // `KerbcastProvider`, same reasoning).
  const client = useKerbcastClient();
  const subscriptions = useKerbcastSubscriptions();

  return (
    <TextButton
      type="button"
      style={AVATAR_BUTTON_STYLE}
      onClick={() =>
        open(
          <KerbcastProvider client={client} subscriptions={subscriptions}>
            <div style={SPOTLIGHT_BODY_STYLE}>
              <KerbalFaceFeed flightId={flightId} size={320}>
                {crewLocation && (
                  <LocationBadge isEva={isEva} corner="spotlight" />
                )}
              </KerbalFaceFeed>
            </div>
          </KerbcastProvider>,
          { title: crewName, width: "360px" },
        )
      }
      aria-label={`Spotlight ${crewName}'s ${isEva ? "EVA" : "seated"} face camera`}
    >
      <KerbalFaceFeed flightId={flightId} showActions={false}>
        {crewLocation && <LocationBadge isEva={isEva} corner="avatar" />}
      </KerbalFaceFeed>
    </TextButton>
  );
}

/**
 * EVA/IVA corner badge, composed from the shared `Badge` (ui-kit) rather than
 * a bespoke styled span: two sizes (`avatar`: tiny, over the ~40px roster
 * cell; `spotlight`: the ui-kit default, over the 320px modal view).
 */
function LocationBadge({
  isEva,
  corner,
}: {
  isEva: boolean;
  corner: "avatar" | "spotlight";
}) {
  return (
    <Badge
      severity={isEva ? "warning" : "info"}
      size={corner === "avatar" ? "sm" : "md"}
      style={
        corner === "avatar" ? AVATAR_BADGE_POSITION : SPOTLIGHT_BADGE_POSITION
      }
    >
      {isEva ? "EVA" : "IVA"}
    </Badge>
  );
}

registerAugment({
  id: "kerbcast-crew-avatar",
  augments: "crew-status.avatar",
  requires: "kerbcast",
  component: KerbcastAvatarAugment,
});

export { selectKerbalCamera };

// ── Styles ────────────────────────────────────────────────────────────────
// Inline style objects + ui-kit primitives (Badge, TextButton) rather than a
// bespoke styled-components import: TextButton already carries the no-chrome
// reset and the shared `:focus-visible` ring; only the sizing here is local.

const AVATAR_BUTTON_STYLE: CSSProperties = {
  position: "relative",
  display: "block",
  width: "100%",
  height: "100%",
  padding: 0,
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
};

const SPOTLIGHT_BODY_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

// All five numbers stay literal and move together or not at all. The 7px font
// is deliberately off every scale (4px below the smallest rung) so this
// three-character badge fits the corner of a ~40px roster cell, and the 1px
// offsets, the 3px horizontal padding and the 1.3 line box were all tuned
// around it. Taking --space-2 (-1px per side) and --line-height-body (+0.1)
// while the anchor value is held fixed re-tunes the badge in two directions
// at once.
const AVATAR_BADGE_POSITION: CSSProperties = {
  position: "absolute",
  bottom: 1,
  right: 1,
  fontSize: 7,
  padding: "1px 3px",
  lineHeight: 1.3,
};

const SPOTLIGHT_BADGE_POSITION: CSSProperties = {
  position: "absolute",
  bottom: "var(--space-6)",
  right: "var(--space-6)",
};
