import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@gonogo/core";
import {
  type StreamStatusValue,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  type VesselState,
} from "@gonogo/sitrep-client";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  type ReadoutTone,
  StatusPill,
  StreamStatusBadge,
} from "@gonogo/ui";
import { useCallback, useSyncExternalStore } from "react";
import styled from "styled-components";
import { useBodyRotation } from "../SystemView/useBodyRotation";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { useIsOrbiting } from "../shared/useIsOrbiting";

/**
 * Provider-optional read of a raw OR derived stream Topic — mirrors
 * `@gonogo/sitrep-client`'s `useStream`, but returns `undefined` when no
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
              <StreamStatusBadge status={streamStatus} />
            </TitleRow>
            {bodyName !== undefined && (
              <PanelSubtitle>{bodyName}</PanelSubtitle>
            )}
            <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
          </LandscapeChrome>
          <LandscapeDiagramSlot>{diagram}</LandscapeDiagramSlot>
        </LandscapeRow>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ORBIT VIEW</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>{bodyName}</PanelSubtitle>
      )}

      {!hasOrbit ? (
        <NoData>No orbital data</NoData>
      ) : showDiagram ? (
        diagram
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
