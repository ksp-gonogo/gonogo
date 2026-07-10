import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type StreamStatusValue,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  type ReadoutTone,
  StatusPill,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { useCallback, useSyncExternalStore } from "react";
import styled from "styled-components";
import { useBodyRotation } from "../SystemView/useBodyRotation";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { useIsOrbiting } from "../shared/useIsOrbiting";

/**
 * Provider-optional read of a raw OR derived stream Topic — mirrors
 * `@ksp-gonogo/sitrep-client`'s `useStream`, but returns `undefined` when no
 * `TelemetryProvider` is mounted instead of throwing. OrbitView reads its
 * derived `vessel.state.*` fields (which are not wire `TopicId`s, so the
 * canonical `useTelemetry` overload can't type them) through this and stays
 * crash-safe in a provider-less render (the widget gallery / probe harness) by
 * degrading to its "No orbital data" empty state.
 */
function useStreamOptional<T>(topic: string): T | undefined {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback((): T | undefined => {
    if (!store) return undefined;
    // A derived channel's `derive` runs inside `sample` and can throw — e.g.
    // `deriveVesselState`'s OnRails branch calls the elliptical-only Kepler
    // solver, which throws for a hyperbolic orbit (ecc≥1, an escape
    // trajectory). Degrade to `undefined` rather than crashing the widget;
    // the fields read through this hook (trueAnomaly / parentBodyName) are
    // non-essential and their consumers already tolerate `undefined`.
    try {
      const point = store.sample<T>(topic, store.currentFrame());
      return point ? (point.payload as T | undefined) : undefined;
    } catch {
      return undefined;
    }
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Provider-optional staleness/absence surface for a raw stream Topic — the
 * `useStreamOptional` sibling for status. `"disconnected"` when no
 * `TelemetryProvider` is mounted, matching the empty-state posture the value
 * read degrades to.
 */
function useStreamStatusOptional(topic: string): StreamStatusValue {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback(
    (): StreamStatusValue =>
      store ? store.sampleStatus(topic, store.currentFrame()) : "disconnected",
    [store, topic],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
}

// ---------------------------------------------------------------------------
// Augment slots (Uplink architecture spec §4). OrbitView is a HOST that exposes
// two slots; no first-party augment fills them here (that is a later phase), so
// each renders nothing until an Uplink registers an augment into it.
// ---------------------------------------------------------------------------

/**
 * Props for `orbit-view.overlay` — an OVERLAY slot (spec §4.8), rendered in a
 * layer absolutely positioned over the orbit-ellipse diagram. The diagram draws
 * body-centric in SVG user-units that match these orbital elements: the body
 * sits at `center` (the SVG origin), +x runs along the apsis line before
 * `argPe` rotation, +y is up in the orbital frame, and the visible half-extent
 * is ~`scale` units (apoapsis-driven, matching the diagram's own scale
 * reference). An overlay augment — e.g. a future N-body / SOI-transition Uplink
 * — builds a matching viewBox / transform from these to draw markers in the
 * diagram's coordinate space.
 */
export interface OrbitOverlayContext {
  /** Semi-major axis, distance units (metres from body centre). */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /** Apoapsis radius from body centre, same units. */
  apoapsis: number;
  /** Periapsis radius from body centre, same units. */
  periapsis: number;
  /** Argument of periapsis, degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Current vessel true anomaly, degrees. */
  trueAnomaly: number;
  /** Parent body physical radius, same units, when known. */
  bodyRadius?: number;
  /** The body's position in the diagram's SVG frame (its origin). */
  center: { x: number; y: number };
  /** Visible half-extent of the frame, distance units (apoapsis-driven). */
  scale: number;
}

/**
 * Props for `orbit-view.badges` — the widget's BROAD escape-hatch slot (spec
 * §4.8 composable badges), rendered in the header next to the title. Meant for
 * small status chips an Uplink wants beside the orbit heading; badge augments
 * read their own Topics via hooks, so the only context passed down is the
 * parent body name for labelling.
 */
export interface OrbitBadgesContext {
  bodyName: string | undefined;
}

// Co-located declaration-merge of this widget's slot ids → their props (spec
// §4.6). Kept next to the widget (not in a central registry file) so parallel
// slot work on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "orbit-view.overlay": OrbitOverlayContext;
    "orbit-view.badges": OrbitBadgesContext;
  }
}

const orbitViewActions = [
  {
    id: "toggleMarkers",
    label: "Toggle Markers",
    accepts: ["button"],
    description: "Show or hide the Ap/Pe markers.",
  },
] as const satisfies readonly ActionDefinition[];

export type OrbitViewActions = typeof orbitViewActions;

function OrbitViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<OrbitViewConfig>>) {
  const showMarkers = config?.showMarkers ?? true;

  useActionInput<OrbitViewActions>({
    toggleMarkers: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showMarkers;
      onConfigChange?.({ ...config, showMarkers: next });
      return { markersVisible: next };
    },
  });

  // R6 de-Telemachus: every read rides the SDK stream directly, no legacy
  // `useDataValue("data", …)` fallback.
  //  - `vessel.orbit` (raw Topic) carries the elements `sma`/`ecc`/`argPe`.
  //  - `vessel.state` (client-side derived channel, SharedLib §1b) carries
  //    `trueAnomaly` (propagated at view-UT) and `parentBodyName` (identity
  //    index → `system.bodies` name). It isn't a wire `TopicId`, so it reads
  //    through the provider-optional `useStreamOptional`.
  //  - The apsis RADII are the raw elements themselves (`sma·(1±ecc)`) — a
  //    trivial, conic-agnostic formula computed here rather than read from
  //    `vessel.state.apoapsisRadius`/`periapsisRadius`, because
  //    `deriveVesselState`'s OnRails branch throws for hyperbolic orbits
  //    (ecc≥1, escape trajectories) before it ever computes those fields.
  //  - `useBodyRotation` derives the pole marker client-side from the body's
  //    `rotationPeriod` + view-UT (SharedLib §1b); `useIsOrbiting` stays a
  //    shared hook.
  const orbit = useTelemetry("vessel.orbit");
  const vesselState = useStreamOptional<VesselState>("vessel.state");
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe ?? undefined;
  const trueAnomaly = vesselState?.trueAnomaly ?? undefined;
  const bodyName = vesselState?.parentBodyName ?? undefined;
  const apoapsisR =
    sma !== undefined && eccentricity !== undefined
      ? sma * (1 + eccentricity)
      : undefined;
  const periapsisR =
    sma !== undefined && eccentricity !== undefined
      ? sma * (1 - eccentricity)
      : undefined;
  // Connectivity indicator — `vessel.orbit` is this widget's representative
  // read Topic (it gates the diagram's elements), so one badge speaks for the
  // whole widget.
  const streamStatus = useStreamStatusOptional("vessel.orbit");

  const body = bodyName === undefined ? undefined : getBody(bodyName);
  const { isOrbiting } = useIsOrbiting();
  // Live rotation feed — single-body subscription so we don't pay the
  // ~17-bodies-at-4Hz fanout cost of useCelestialBodies just for the
  // marker. Atmosphere band sticks to the static body registry's
  // `maxAtmosphere`, which already covers stock bodies.
  const { angleDeg: rotationAngleDeg, rotates } = useBodyRotation(
    typeof bodyName === "string" ? bodyName : null,
  );

  const hasOrbit =
    sma !== undefined &&
    eccentricity !== undefined &&
    apoapsisR !== undefined &&
    periapsisR !== undefined;

  // Selective rendering — at small sizes the SVG diagram doesn't have room
  // to be readable, so collapse to a single status pill (the user's
  // canonical example for "tiny mode"). Accept either:
  //   - Square / portrait ≥ 5 cols × 5 rows (the original threshold), or
  //   - Landscape ≥ 8 cols × 3 rows (wide-short, e.g. the dashboard's
  //     header strip — the diagram + chrome render side-by-side so the
  //     diagram gets a usable square slot at panel height instead of
  //     being squeezed under the title.).
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showDiagram = (rows >= 5 && cols >= 5) || (cols >= 8 && rows >= 3);
  // Landscape gate: wide-short slots flow the layout horizontally so the
  // diagram doesn't have to share vertical real estate with the header.
  const isLandscape = cols >= 8 && rows < 5;
  const showSubtitle = rows >= 4;

  // 3×3 minSize panel is ~104 px wide; the multi-word pill labels wrap
  // to two lines ("STABLE\nORBIT", "SUB-\nORBITAL"). At that size,
  // abbreviate so the status fits on one line — abbreviations are the
  // standard mission-control shorthand the operator already reads
  // elsewhere (e.g. flight-plan annotations).
  const compactPill = cols < 4 || rows < 4;
  let pillLabel = "—";
  let pillTone: ReadoutTone = "default";
  if (hasOrbit) {
    if (eccentricity >= 1) {
      pillLabel = compactPill ? "ESC" : "Escape";
      pillTone = "warning";
    } else if (isOrbiting) {
      pillLabel = compactPill ? "ORBIT" : "Stable orbit";
      pillTone = "go";
    } else {
      pillLabel = compactPill ? "SUB-O" : "Sub-orbital";
      pillTone = "alert";
    }
  }

  const diagram = hasOrbit ? (
    <OrbitDiagram
      variant="full"
      sma={sma}
      ecc={eccentricity}
      apoapsis={apoapsisR}
      periapsis={periapsisR}
      trueAnomaly={trueAnomaly ?? 0}
      argPe={argPe ?? 0}
      showMarkers={showMarkers}
      bodyColor={body?.color}
      bodyRadius={body?.radius}
      isOrbiting={isOrbiting}
      rotationAngleDeg={rotates === false ? null : rotationAngleDeg}
      atmosphereDepthM={body?.hasAtmosphere ? body.maxAtmosphere : null}
      atmosphereHasOxygen={
        // Kerbin / Laythe are the stock oxygen-bearing atmospheres.
        // Static registry doesn't carry the flag yet — treat as oxygen
        // for those names, plain for the rest. Cheap; gets replaced
        // when the static body registry grows a `hasOxygen` field.
        body !== undefined && (body.id === "Kerbin" || body.id === "Laythe")
      }
    />
  ) : null;

  // Slot props (spec §4.4). `badges` carries just the body name for labelling;
  // `overlay` carries the diagram's body-centric projection so an augment can
  // draw in the SVG's coordinate space. `overlay` is null until the elements
  // resolve — the wrapper only mounts the slot once there's a diagram beneath.
  const badgesContext: OrbitBadgesContext = { bodyName };
  const overlayContext: OrbitOverlayContext | null =
    sma !== undefined &&
    eccentricity !== undefined &&
    apoapsisR !== undefined &&
    periapsisR !== undefined
      ? {
          sma,
          ecc: eccentricity,
          apoapsis: apoapsisR,
          periapsis: periapsisR,
          argPe: argPe ?? 0,
          trueAnomaly: trueAnomaly ?? 0,
          bodyRadius: body?.radius,
          center: { x: 0, y: 0 },
          scale: apoapsisR,
        }
      : null;

  // Compose the diagram with its overlay layer. The layer is absolutely
  // positioned over the diagram and stays out of the diagram's pointer path
  // (see `OverlayLayer`), so an empty slot is visually and interactively inert.
  const diagramWithOverlay =
    diagram && overlayContext ? (
      <DiagramOverlayWrap>
        {diagram}
        <OverlayLayer>
          <AugmentSlot name="orbit-view.overlay" props={overlayContext} />
        </OverlayLayer>
      </DiagramOverlayWrap>
    ) : (
      diagram
    );

  if (isLandscape && showDiagram && hasOrbit) {
    // Wide-short slot: chrome on the left, diagram on the right. The
    // diagram lives in a square slot taking the full panel height, which
    // is much more visible than the portrait fallback (where the title
    // row eats most of the vertical space). Header content stacks
    // vertically in the left chrome — title, body name, status pill.
    return (
      <Panel>
        <LandscapeRow>
          <LandscapeChrome>
            <TitleRow>
              <PanelTitle>ORBIT VIEW</PanelTitle>
              <AugmentSlot name="orbit-view.badges" props={badgesContext} />
              <StreamStatusBadge status={streamStatus} />
            </TitleRow>
            {bodyName !== undefined && (
              <PanelSubtitle>{bodyName}</PanelSubtitle>
            )}
            <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
          </LandscapeChrome>
          <LandscapeDiagramSlot>{diagramWithOverlay}</LandscapeDiagramSlot>
        </LandscapeRow>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ORBIT VIEW</PanelTitle>
        <AugmentSlot name="orbit-view.badges" props={badgesContext} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>{bodyName}</PanelSubtitle>
      )}

      {!hasOrbit ? (
        <NoData>No orbital data</NoData>
      ) : showDiagram ? (
        diagramWithOverlay
      ) : (
        <PillFill>
          <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
        </PillFill>
      )}
    </Panel>
  );
}

registerComponent<OrbitViewConfig>({
  id: "orbit-view",
  name: "Orbit View",
  description:
    "SVG diagram of the current orbit ellipse with vessel position, apoapsis, and periapsis markers.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  minSize: { w: 3, h: 3 },
  component: OrbitViewComponent,
  // Exposes an overlay slot (drawn over the SVG diagram, passed the diagram's
  // projection) and a broad badges escape-hatch slot in the header. No
  // first-party augment fills either yet (spec §4).
  augmentSlots: ["orbit-view.overlay", "orbit-view.badges"],
  // Legacy `dataRequirements` kept during migration (rename/removal is R7);
  // the reads themselves are stream-native (`vessel.orbit` + the `vessel.state`
  // derived channel).
  dataRequirements: [
    "o.sma",
    "o.eccentricity",
    "o.trueAnomaly",
    "o.ApR",
    "o.PeR",
    "o.ApA",
    "o.PeA",
    "o.argumentOfPeriapsis",
    "v.body",
    "b.number",
  ],
  defaultConfig: { showMarkers: true },
  actions: orbitViewActions,
  pushable: true,
  requires: ["flight"],
});

export { OrbitViewComponent };

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const NoData = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
  padding: 8px 0;
`;

const PillFill = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const DiagramOverlayWrap = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

const OverlayLayer = styled.div`
  position: absolute;
  inset: 0;
  /* Keep the diagram beneath interactive; an overlay augment re-enables
     pointer events on its own elements when it needs them. */
  pointer-events: none;
`;

const LandscapeRow = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  min-width: 0;
`;

const LandscapeChrome = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  /* Narrow column for header content — the diagram on the right gets
     everything left over. */
  min-width: 0;
`;

const LandscapeDiagramSlot = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
`;
