import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  useOrbitTrajectory,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { apsidesExist, type ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import { Panel, type ReadoutTone, StatusPill } from "@ksp-gonogo/ui";
import { NULL_DISPLAY, Section, Text } from "@ksp-gonogo/ui-kit";
import { useCallback, useSyncExternalStore } from "react";
import styled from "styled-components";
import { useBodyRotation } from "../SystemView/useBodyRotation";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import {
  trajectoryWithheldCopy,
  type WithheldTrajectory,
} from "../shared/trajectoryWithheld";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { usePastTrack } from "../shared/usePastTrack";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "vessel.state", "system.bodies"],
  /*
   * The diagram is drawn from apsis RADII, never the altitudes. Body geometry
   * comes off `system.bodies`, which is why that channel is carried: the pole
   * marker's own orientation still uses the static table, for the texture
   * correction no wire field replaces. Naming the fields drawn, rather than
   * the whole of `vessel.state` this mounts on, is what keeps their alarms off
   * a widget that does not draw them.
   */
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.argPe",
    "vessel.state.apoapsisRadius",
    "vessel.state.periapsisRadius",
    "vessel.state.trueAnomaly",
    "vessel.state.parentBodyName",
  ],
});

/**
 * Provider-optional read of a raw OR derived stream Topic, mirrors
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
    const point = store.sample<T>(topic, store.currentFrame());
    return point ? (point.payload as T | undefined) : undefined;
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
}

// ---------------------------------------------------------------------------
// Augment slots (Uplink architecture). OrbitView is a HOST that exposes
// two slots; no first-party augment fills them here, so
// each renders nothing until an Uplink registers an augment into it.
// ---------------------------------------------------------------------------

/**
 * Props for `orbit-view.overlay`: an OVERLAY slot, rendered in a
 * layer absolutely positioned over the orbit-ellipse diagram. The diagram draws
 * body-centric in SVG user-units that match these orbital elements: the body
 * sits at `center` (the SVG origin), +x runs along the apsis line before
 * `argPe` rotation, +y is up in the orbital frame, and the visible half-extent
 * is ~`scale` units, apoapsis-driven, matching the diagram's own scale
 * reference, EXCEPT on a hyperbolic orbit (`ecc >= 1`), where apoapsis is
 * meaningless and both this and the diagram itself scale off periapsis
 * instead (see `OrbitDiagram`'s `HYPERBOLIC_SCALE`). An overlay augment,
 * e.g. a future N-body / SOI-transition Uplink, builds a matching viewBox /
 * transform from these to draw markers in the diagram's coordinate space.
 */
export interface OrbitOverlayContext {
  /** Semi-major axis, distance units (metres from body centre). */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /**
   * Apoapsis radius from body centre, same units. `undefined` on a
   * hyperbolic orbit (`ecc >= 1`): there is no apoapsis to report (see
   * `VesselState.apoapsisRadius`'s doc comment).
   */
  apoapsis?: number;
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

// Co-located declaration-merge of this widget's slot ids → their props.
// Kept next to the widget (not in a central registry file) so parallel
// slot work on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "orbit-view.overlay": OrbitOverlayContext;
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

/**
 * What the panel says when the propagation seam declines to authorise a curve.
 *
 * The sentences come from the one shared table, so this panel and the five
 * other drawings that can now be refused name the same refusal the same way.
 * Only the container is local: OrbitView's refusal takes over the whole panel
 * body, where CurrentOrbit's takes over a strip beside the numbers.
 */
function TrajectoryWithheld({
  withheld,
}: Readonly<{ withheld: WithheldTrajectory }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <NoData role="status">
      <Text size="xs">{heading}</Text>
      <Text tone="muted" size="xs">
        {detail}
      </Text>
    </NoData>
  );
}

function OrbitViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<OrbitViewConfig>>) {
  /**
   * The apsis markers, gated on the operator's own view frame as well as their
   * config. An apsis is defined against a centre, and the frames defined by a
   * pair of bodies have none: drawing a dot labelled Ap in one of those puts a
   * marker on a point that does not exist, next to a panel elsewhere on the
   * dashboard saying so.
   */
  const controlFrame = useStreamOptional<ControlFrame>("system.frame");
  const noApsidesHere = apsidesExist(controlFrame) === "invalid";
  const showMarkers = (config?.showMarkers ?? true) && !noApsidesHere;

  useActionInput<OrbitViewActions>({
    toggleMarkers: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showMarkers;
      onConfigChange?.({ ...config, showMarkers: next });
      return { markersVisible: next };
    },
  });

  // Every read rides the SDK stream directly, no legacy
  // `useTelemetry("data", ...)` fallback.
  //  - `vessel.orbit` (raw Topic) carries the elements `sma`/`ecc`/`argPe`.
  //  - `vessel.state` (client-side derived channel) carries
  //    `trueAnomaly` (propagated at view-UT), `parentBodyName` (identity
  //    index → `system.bodies` name), `basis` ("propagated" | "measured"),
  //    and the apsis RADII. It isn't a wire `TopicId`, so it reads through
  //    the provider-optional `useStreamOptional`.
  //  - The apsis radii are read from `vessel.state.apoapsisRadius`/
  //    `periapsisRadius` rather than computed here (`sma·(1±ecc)`), that
  //    formula is meaningless for apoapsis on a hyperbolic orbit (sma<0
  //    makes it a finite but GARBAGE negative number) and for both apsides
  //    in the "measured" basis (Loaded-basis osculating elements). Correctly
  //    `null` in both cases per `deriveVesselState`'s `trySolve`/
  //    `trySolveAnomalies` (non-throwing: see `vessel-state.ts`).
  //  - `useBodyRotation` derives the pole marker client-side from the body's
  //    `rotationPeriod` + view-UT; `useIsOrbiting` stays a shared hook.
  // This widget DRAWS the orbit and the craft's place on it, which is a marker:
  // a positive claim about where it is now. So the elements come from a CURRENT
  // reading, or from a model where one is on offer, and otherwise from nothing,
  // and the diagram's own absent-value rendering takes over. Same decision as
  // MapView, SystemView and FleetComms.
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit =
    orbitReading.state === "observed"
      ? orbitReading.value
      : orbitReading.state === "reckonable"
        ? orbitReading.reckoned.value
        : undefined;
  const orbitStale = orbitReading.state === "stale";
  /**
   * Where the craft has been, drawn behind it. Five minutes: long enough to
   * read as a direction of travel on a low orbit, and short enough to stay
   * within samples this frame can place.
   */
  const trail = usePastTrack(300, orbit);
  const vesselState = useStreamOptional<VesselState>("vessel.state");
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe ?? undefined;
  const trueAnomaly = vesselState?.trueAnomaly ?? undefined;
  const bodyName = vesselState?.parentBodyName ?? undefined;
  const basis = vesselState?.basis;
  // `null` on a hyperbolic orbit (no apoapsis exists) or in the "measured"
  // basis (both apsides): see `VesselState.apoapsisRadius`'s doc comment.
  const apoapsisR = vesselState?.apoapsisRadius;
  // `null` only in the "measured" basis: always real whenever there's a
  // resolvable orbit, hyperbolic or not.
  const periapsisR = vesselState?.periapsisRadius;

  // What the trajectory IS, asked of the propagation seam rather than decided
  // here. The widget holds `sma` and `ecc` and could draw an ellipse from them
  // without asking anything, which is exactly why it must not: a provider whose
  // trajectories are integrated would then change nothing the operator sees.
  // `useOrbitTrajectory` reads the horizon riding on this same sample and
  // answers conic, arc, or a refusal, and the render below does as it is told.
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);

  /*
   * The body the stream describes, not the stock table's namesake. The table
   * is keyed by NAME and holds stock bodies only, so under a planet pack the
   * lookup missed and this widget lost its radius, its atmosphere band and its
   * oxygen shading together. The oxygen flag in particular used to be a
   * comparison against the two stock breathable bodies, under a comment
   * waiting for "the static body registry to grow a `hasOxygen` field": it
   * never did, and never needed to, because `system.bodies` has carried the
   * flag per body all along.
   */
  const body = useStreamBody(bodyName);
  const { isOrbiting } = useIsOrbiting();
  // Live rotation feed: single-body subscription so we don't pay the
  // ~17-bodies-at-4Hz fanout cost of useCelestialBodies just for the
  // marker. Atmosphere band sticks to the static body registry's
  // `maxAtmosphere`, which already covers stock bodies.
  const { angleDeg: rotationAngleDeg, rotates } = useBodyRotation(
    typeof bodyName === "string" ? bodyName : null,
  );

  // Apoapsis is intentionally NOT required, it's `null` on a hyperbolic
  // orbit (no apoapsis exists) by design, not an error. Periapsis is
  // always real whenever there IS an orbit, so it (plus sma/eccentricity)
  // is the true "do we have an orbit" signal. `!= null` catches both
  // `null` and `undefined` (a naive `apoapsisRadius ?? undefined` upstream
  // must not be able to flip this gate).
  const hasOrbit = sma != null && eccentricity != null && periapsisR != null;

  // A withheld trajectory is not a missing orbit: the elements arrived, and the
  // provider declined to authorise a curve through them. The two get different
  // sentences because they have different remedies, the same reason
  // `TrajectoryCurrencyBridge` refuses to collapse its own two refusals.
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  const hasTrajectory = hasOrbit && trajectory !== null && withheld === null;

  // Selective rendering: at small sizes the SVG diagram doesn't have room
  // to be readable, so collapse to a single status pill (the user's
  // canonical example for "tiny mode"). Accept either:
  //   - Square / portrait ≥ 5 cols × 5 rows (the original threshold), or
  //   - Landscape ≥ 8 cols × 3 rows (wide-short, e.g. the dashboard's
  //     header strip: the diagram + chrome render side-by-side so the
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
  // abbreviate so the status fits on one line, abbreviations are the
  // standard mission-control shorthand the operator already reads
  // elsewhere (e.g. flight-plan annotations).
  const compactPill = cols < 4 || rows < 4;
  // The header row gives the title a fixed reserved width and does not grow
  // it into a chevron-collapsed aside's freed space, so a title that doesn't
  // fit at this column count is squeezed far below what the row actually has
  // room for. Same threshold and the same reasoning as `compactPill` above
  // (only the COLUMN count matters here, not rows: a title truncates
  // horizontally, so a wide-but-short landscape slot needs no shortening).
  const compactTitle = cols < 4;
  const panelTitleText = compactTitle ? "OVIEW" : "ORBIT VIEW";
  let pillLabel = NULL_DISPLAY;
  let pillTone: ReadoutTone = "default";
  if (hasOrbit) {
    if (eccentricity.greaterThanOrEqual(1)) {
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

  const diagram = hasTrajectory ? (
    <OrbitDiagram
      variant="full"
      // The seam's answer, drawn as given. `null` on the conic arm, where the
      // diagram's own conic renderer is what the provider said is right.
      trajectoryPath={trajectory.shape === "arc" ? trajectory.points : null}
      trailPath={trail}
      trajectoryFarEnd={trajectory.shape === "arc" ? trajectory.farEnd : null}
      sma={sma.magnitude}
      ecc={eccentricity.magnitude}
      // `apoapsisR` is `null` on a hyperbolic orbit, OrbitDiagram already
      // detects that itself (`ecc >= 1 || sma <= 0`) and ignores this value
      // in that branch, so the fallback is never actually rendered from.
      apoapsis={apoapsisR ?? 0}
      periapsis={periapsisR}
      trueAnomaly={trueAnomaly ?? 0}
      argPe={argPe?.magnitude ?? 0}
      showMarkers={showMarkers}
      bodyColor={body?.color}
      bodyRadius={body?.radius}
      isOrbiting={isOrbiting}
      rotationAngleDeg={rotates === false ? null : rotationAngleDeg}
      atmosphereDepthM={body?.hasAtmosphere ? body.maxAtmosphere : null}
      atmosphereHasOxygen={body?.hasOxygen ?? false}
    />
  ) : null;

  // Slot props. `overlay` carries the diagram's body-centric projection so an
  // augment can draw in the SVG's coordinate space. It is null until the
  // elements resolve: the wrapper only mounts the slot once there's a diagram
  // beneath.
  // Mirrors `OrbitDiagram`'s own `HYPERBOLIC_SCALE` constant so the overlay
  // slot's declared `scale` matches the diagram's ACTUAL bounds on a
  // hyperbolic trajectory, where apoapsis is meaningless and the diagram
  // scales off periapsis instead (see OrbitDiagram.tsx).
  const HYPERBOLIC_OVERLAY_SCALE = 5;
  const overlayContext: OrbitOverlayContext | null =
    sma != null && eccentricity != null && periapsisR != null
      ? {
          // The overlay slot is a DRAWING contract: an Uplink gets the same
          // plot-space numbers the diagram itself works in.
          sma: sma.magnitude,
          ecc: eccentricity.magnitude,
          apoapsis: apoapsisR ?? undefined,
          periapsis: periapsisR,
          argPe: argPe?.magnitude ?? 0,
          trueAnomaly: trueAnomaly ?? 0,
          bodyRadius: body?.radius,
          center: { x: 0, y: 0 },
          scale: eccentricity.greaterThanOrEqual(1)
            ? periapsisR * HYPERBOLIC_OVERLAY_SCALE
            : (apoapsisR ?? periapsisR),
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

  if (isLandscape && showDiagram && hasTrajectory) {
    // Wide-short slot: chrome on the left, diagram on the right, via
    // `panelSidebar`. Body name and status pill stack in the sidebar column;
    // the panel's own header sits above the diagram (a non-floating header
    // is scoped to the body track it precedes, not the sidebar beside it),
    // which is still far cheaper than the portrait fallback below, where the
    // title row runs the full width and the diagram gets whatever besides.
    return (
      <Panel
        panelTitle={panelTitleText}
        panelSidebar={
          <LandscapeChrome>
            {bodyName !== undefined && (
              <Text tone="muted" size="xs">
                {bodyName}
              </Text>
            )}
            <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
          </LandscapeChrome>
        }
        sidebarSide="start"
        sidebarSize="8rem"
        sections={<Section fill>{diagramWithOverlay}</Section>}
      />
    );
  }

  // The diagram runs under the title rather than beside it, and the title
  // floats over it. In portrait a title row of its own eats most of the
  // vertical space (the comment on the landscape branch above says so), and an
  // orbit ellipse is the kind of content that wants the whole tile: the corner
  // it loses to a backed title is far cheaper than a reserved row. Only when
  // there IS a diagram, though. The no-data and pill-only branches are centred
  // text, and floating a title over centred text just overlaps it.
  const drawingFillsPanel = hasTrajectory && showDiagram;
  // Where the body name goes follows the header. The floating case rides it
  // along in the aside, beside the title, at zero cost to the body track; the
  // non-floating case puts it in the body as a caption, gated on the same
  // height tier (`showSubtitle`) as every other caption.
  const showBodyNameInAside = drawingFillsPanel && bodyName !== undefined;
  const showBodyNameInBody =
    !drawingFillsPanel && showSubtitle && bodyName !== undefined;
  return (
    <Panel
      panelTitle={panelTitleText}
      // The stream badge is gone from here on purpose: the composed header
      // renders the host-derived status, which watches every topic this widget
      // declares rather than the one this hook picked by hand.
      panelAside={
        showBodyNameInAside ? (
          <Text tone="muted" size="xs">
            {bodyName}
          </Text>
        ) : undefined
      }
      floatingHeader={drawingFillsPanel}
    >
      {showBodyNameInBody && (
        <Text tone="muted" size="xs">
          {bodyName}
        </Text>
      )}
      {/* Which frame the drawing below is in. An orbit that closes in one frame
          is a rosette in another, so the curve is only readable next to its
          own frame's name. Gated on `showDiagram`: below that threshold there
          is no drawing for the caption to be about, only the status pill,
          which already says everything this size has room to say. */}
      {showDiagram && (
        <TrajectoryFrameCaption
          trajectory={trajectory}
          centreBodyIndex={orbit?.referenceBodyIndex}
        />
      )}
      {!hasOrbit ? (
        <NoData>
          {/* "measured" (Loaded/packed) basis: there IS an orbit, just no
              osculating elements to derive a diagram from, distinct from
              the genuine no-data case (basis undefined, nothing has
              arrived yet). */}
          {basis === "measured"
            ? "No osculating orbit (packed)"
            : "No orbital data"}
        </NoData>
      ) : !showDiagram ? (
        // Tiny mode, and the refusal does NOT displace the pill here. The pill
        // reports the craft's state at this instant, which is a fact the
        // osculating elements do carry whoever computed them; only the PATH is
        // in question. A ~104 px cell has no room for both, and the one that
        // survives should be the one still true.
        <PillFill>
          <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
        </PillFill>
      ) : withheld ? (
        <TrajectoryWithheld withheld={withheld} />
      ) : (
        diagramWithOverlay
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
  // Exposes an overlay slot, drawn over the SVG diagram and passed the
  // diagram's projection. No first-party augment fills it yet.
  augmentSlots: ["orbit-view.overlay"],
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { showMarkers: true },
  actions: orbitViewActions,
  pushable: true,
  requires: ["flight"],
});

export { OrbitViewComponent };

const NoData = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  padding: var(--space-8) 0;
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

/**
 * The landscape branch's sidebar content: body name and status pill, stacked
 * and vertically centred in the narrow column `panelSidebar` reserves beside
 * the diagram.
 */
const LandscapeChrome = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  justify-content: center;
  min-width: 0;
  min-height: 0;
`;
