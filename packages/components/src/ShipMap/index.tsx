import type {
  ComponentProps,
  Contributed,
  VesselTopology,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useContributions,
} from "@ksp-gonogo/core";
import { usePartsLive, useTopology } from "@ksp-gonogo/data";
import { type Reading, useCommand } from "@ksp-gonogo/sitrep-client";
import { Box, usePanelDelay } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
// Side-effect import: the built-in half of the `ship-map.part-meters`
// self-contribution self-registers on module load, same contract as every
// other built-in registration. See that file's own header for why the five
// classic drainable propellants now live there instead of a hardcoded Set
// inside `ShipDiagramSvg`.
import "./partMetersContribution";
import { INVOKE_PART_ACTION_COMMAND } from "./PartActionMenu";
import { ShipDiagram } from "./ShipDiagram";
import { computeShipLayout, type ShipBounds } from "./ShipDiagramSvg";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
  type ShipMapPartMetaEntry,
  type ShipMapPartMeterEntry,
} from "./shipTopology";

const topics = defineTopicManifest({
  channels: [
    "vessel.parts",
    "vessel.thermal",
    "vessel.flight",
    "vessel.control",
  ],
  // One field off each of the three context channels. ThermalStatus draws the
  // rest of `vessel.thermal`, so mounting on the whole channel without saying
  // this would put its alarms on the ship diagram too.
  fields: [
    "vessel.parts",
    "vessel.thermal.hottestPart.name",
    "vessel.flight.externalTemperature",
    "vessel.control.throttle",
  ],
});

// Re-exported so a sibling file (the contribution-slot-registry conformance
// test, an Uplink's own contribution) can import these from the widget's
// package root the same way every other mirrored slot-context type is
// imported, even though the interfaces themselves are authored in
// `shipTopology.ts` (avoids a type-only import cycle back into this file,
// which itself imports `ShipDiagramSvg`/`ShipDiagram`).
export type { ShipMapPartMetaEntry, ShipMapPartMeterEntry };

// ShipMap is a HOST that exposes two augment slots. No first-party augment
// fills either, so each renders nothing until an Uplink registers into it.

/**
 * Props for `ship-map.overlay`: an OVERLAY slot, rendered in a
 * layer absolutely positioned over the part-diagram canvas. Carries the
 * diagram's base-frame projection so an augment: e.g. an Uplink backing the
 * reliability capability, badging a malfunctioning or critical part directly on
 * the diagram: can place marks in the diagram's own coordinate space.
 *
 * Project a part at metre-space `(lat, axial)` to overlay px with:
 *   x = width / 2 + (lat - bounds.cx) * baseScale
 *   y = height / 2 - (axial - bounds.cy) * baseScale
 * `parts` carries each part's `lat`/`axial`/geometry to feed that transform.
 * This is the identity-camera frame; the diagram's live zoom/pan is internal
 * and not reflected here (matches OrbitView's overlay contract).
 */
export interface ShipMapOverlayContext {
  /** The projected parts (per-part `lat`/`axial`/`flightId`/geometry). */
  parts: readonly ShipMapPart[];
  /** Overlay layer width in px (matches the diagram canvas). */
  width: number;
  /** Overlay layer height in px (matches the diagram canvas). */
  height: number;
  /** Metre-space fit bounds of the projected vessel. */
  bounds: ShipBounds;
  /** Base (identity-camera) metres→px scale. */
  baseScale: number;
  /** Screen-space margin (px) reserved around the fit-scaled diagram. */
  padding: number;
}

// Co-located declaration-merge of this widget's slot ids onto their props types.
// Kept next to the widget (not in a central registry file) so parallel
// slot work on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "ship-map.overlay": ShipMapOverlayContext;
  }

  // The first widget-authored `ContributionRegistry` slots: every other
  // first-party contribution to date rides the automatic
  // `${componentId}.badges` slot, which is a
  // runtime string, never a declared member of this registry (see
  // `useWidgetBadges`'s own doc comment). These two are genuinely typed,
  // declared slots: `ship-map.part-meters` (per-part resource meters) and
  // `ship-map.part-meta` (per-part status/metadata rows), each fed by BOTH
  // the built-in `core` contribution (`./partMetersContribution.ts`) and an
  // Uplink's contribution, on equal footing.
  interface ContributionRegistry {
    "ship-map.part-meters": {
      entry: ShipMapPartMeterEntry;
      topics: "vessel.parts";
    };
    "ship-map.part-meta": {
      entry: ShipMapPartMetaEntry;
    };
  }
}

interface ShipMapConfig {
  /** Reserved. No widget-level options yet; kept for forward
   *  compatibility so saved layouts don't break when options land. */
  _reserved?: never;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

function ShipMapComponent(_props: Readonly<ComponentProps<ShipMapConfig>>) {
  // Reads the `vessel.parts` stream Topic directly and reshapes it into the
  // legacy `VesselTopology` shape (`vesselPartsAdapter.ts`): the mod's
  // channel engine is itself change-gated, so no separate seq-driven
  // refetch is needed to keep steady-state wire bytes down.
  const topology = useTopology();
  /**
   * "Which part is the hottest" is a verdict, not a fact: heat moves between
   * parts while nobody is looking, and the widget spends the answer on a ring
   * drawn around one specific part of the diagram. A held name rings the part
   * that was hottest at last contact and says nothing about the one glowing
   * now, so the verdict is withheld and the header tag says why: the ring
   * disappearing on its own would read as a craft that cooled down.
   */
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const hottestPartName =
    thermalReading.state === "observed"
      ? thermalReading.value.hottestPart?.name
      : undefined;
  /*
   * The tag below claims the ring was withheld, which is only true when nothing
   * was drawn. `vessel.thermal` declares no reckonable value, so the observation
   * is the only thing that ever puts a ring on the diagram and a held reading is
   * exactly the case where none was drawn.
   */
  const hottestNotCurrent = notCurrent(thermalReading);
  // Ambient skin temperature: drives a background tint on the diagram so
  // the operator can see reentry heating at a glance. Per-part heat tints
  // still show on top. Read straight off `vessel.flight` (the same channel
  // AtmosphereProfile's skin-temp read rides).
  // A temperature TINT, not a position: a number that can be dated, and the
  // widget's own currency chrome is what says how old it is. Last observed on
  // every arm that has one.
  const flightReading = topics.useTelemetry("vessel.flight");
  const externalTemperature =
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value.externalTemperature
      : undefined;
  // Current throttle: gates the engine-flame overlay so a staged-but-
  // idle engine doesn't render thrust. Forwarded through ShipDiagram
  // to ShipDiagramSvg.
  // The throttle gates an engine-flame overlay, so a stale one would draw
  // thrust the craft may not be producing. `vessel.control` is a commanded
  // state and declared unmodellable, and the last CONFIRMED throttle is what
  // the craft was doing at last contact; the flame is a depiction of that
  // reading rather than an assertion about now, and the widget's currency
  // chrome dates it. Zero on a cold start, which is what the guard below
  // already did.
  const controlReading = topics.useTelemetry("vessel.control");
  const throttleRaw =
    controlReading.state === "observed" || controlReading.state === "stale"
      ? controlReading.value.throttle
      : undefined;
  const throttle =
    typeof throttleRaw === "number" && Number.isFinite(throttleRaw)
      ? throttleRaw
      : 0;

  // Subscribe to per-part live data (resources + thermal). Dynamic over
  // the topology's part list: the hook re-subscribes when the set of
  // flightIds changes.
  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);

  // The unified self-contribution path: every per-part meter and
  // meta row, built-in and Uplink-contributed alike, arrives through these two typed
  // slots. Grouped by partId here, once, so `ShipDiagramSvg` (the compact
  // in-body fill bars) and `ShipDiagram` (the hover tooltip) both read the
  // SAME per-part lookup rather than each re-deriving it.
  const meterContributions = useContributions("ship-map.part-meters");
  const metaContributions = useContributions("ship-map.part-meta");
  const partMeters = useMemo(
    () => groupByPart(meterContributions, (e) => `${e.partId}:${e.resource}`),
    [meterContributions],
  );
  const partMeta = useMemo(
    () => groupByPart(metaContributions, (e) => `${e.partId}:${e.label}`),
    [metaContributions],
  );

  // Flatten topology + live data into the diagram's view-model. Axis
  // pick happens once per topology rebuild so every part shares the
  // same lateral basis.
  const parts: ShipMapPart[] = useMemo(() => {
    if (!topology) return [];
    const { useX } = pickLateralAxis(topology.parts);
    const orgPosById = new Map(
      topology.parts.map((p) => [p.flightId, p.orgPos]),
    );
    return topology.parts.map((p) => {
      const live = liveByFlightId.get(p.flightId);
      return buildShipMapPart(
        p,
        live?.thermal,
        live?.resources,
        useX,
        live?.partState,
        p.parentFlightId != null ? orgPosById.get(p.parentFlightId) : null,
      );
    });
  }, [topology, liveByFlightId]);

  // Measure the container so the SVG picks a size without a hardcoded
  // value. State-backed ref (rather than useRef) so the effect re-attaches
  // when DiagramWrap mounts: it's only rendered once topology exists, so
  // a plain useRef + [] deps would never see the element.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  useEffect(() => {
    if (!wrapEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const rect = e.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setSize({
            w: Math.floor(rect.width),
            h: Math.floor(rect.height),
          });
        }
      }
    });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  // PAW part actions. The handle lives HERE, at the always-mounted widget, not
  // in the popover: the menu closes the moment an action fires (like a real PAW
  // click), and a handle that unmounted with it would take its in-flight delay
  // row along with it. `usePanelDelay` registers it with the Panel's delay rail
  // AND consumes the must-consume token, so a dispatch can never ship without
  // its delay UX.
  const invokePartAction = useCommand(INVOKE_PART_ACTION_COMMAND);
  usePanelDelay(invokePartAction);

  const onInvokePartAction = useCallback(
    (
      flightId: number,
      eventName: string,
      actionLabel: string,
      partTitle: string,
    ) => {
      void invokePartAction.send(
        // The wire keys parts by the stringified flightID, the same form
        // `vessel.parts` stamps and every cross-channel join uses; the diagram
        // holds it as a number purely for its own geometry.
        { partId: String(flightId), eventName },
        // Operator-facing description for the delay readouts: the raw event name
        // alone would not say which part it acts on.
        { label: `${actionLabel} on ${partTitle}` },
      );
    },
    [invokePartAction],
  );

  const highlight =
    typeof hottestPartName === "string" ? hottestPartName : null;

  const ambientTint = useMemo(
    () => externalTempTint(externalTemperature),
    [externalTemperature],
  );

  // Slot props. `overlay` carries the diagram's base-frame projection so an
  // augment can draw in the diagram's coordinate space. It is null until parts
  // resolve, the overlay layer only mounts once there's a diagram beneath it.
  const overlayContext: ShipMapOverlayContext | null = useMemo(() => {
    if (parts.length === 0) return null;
    const { bounds, baseScale, padding } = computeShipLayout(
      parts,
      size.w,
      size.h,
    );
    return {
      parts,
      width: size.w,
      height: size.h,
      bounds,
      baseScale,
      padding,
    };
  }, [parts, size]);

  return (
    <Box surface="app" style={MAP_SURFACE}>
      {renderBody(
        topology,
        parts,
        highlight,
        hottestNotCurrent,
        size,
        setWrapEl,
        ambientTint,
        throttle,
        overlayContext,
        partMeters,
        partMeta,
        onInvokePartAction,
      )}
    </Box>
  );
}

/**
 * Groups aggregated contribution entries by `partId`, deduplicating on
 * `dedupeKey` so two contributors landing an entry for the same identity
 * (e.g. the same part+resource pair) don't render two overlapping bars. Kept
 * to first-wins: `useContributions` already returns entries in the
 * aggregator's priority/registration order (`getContributionsForSlot`'s own
 * sort), so "first" here means "highest-priority contributor", the same rule
 * every other contribution-consuming surface in the framework relies on.
 */
function groupByPart<E extends { partId: string }>(
  entries: readonly Contributed<E>[],
  dedupeKey: (entry: E) => string,
): Map<string, E[]> {
  const seen = new Set<string>();
  const out = new Map<string, E[]>();
  for (const entry of entries) {
    const key = dedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(entry.partId);
    if (list) list.push(entry);
    else out.set(entry.partId, [entry]);
  }
  return out;
}

/**
 * Map ambient external temperature (kelvin) to an rgba string that fades
 * the diagram background blue (cold) → transparent → amber → red as the
 * vessel heats up. Returns `null` when there's no signal, the styled
 * background falls back to the surface colour. Keeps alpha capped at 0.25
 * so the per-part heat tints stay visible.
 */
function externalTempTint(temperatureK: unknown): string | null {
  if (typeof temperatureK !== "number" || !Number.isFinite(temperatureK)) {
    return null;
  }
  // Anchor points: 200 K = deep cold (subtle blue), 290 K = ambient (clear),
  // 600 K = warning amber, 1500+ K = reentry red.
  if (temperatureK <= 250) {
    const alpha = Math.min(0.18, (290 - temperatureK) / 600);
    return `rgba(80, 140, 220, ${alpha.toFixed(3)})`;
  }
  if (temperatureK <= 320) return null;
  if (temperatureK <= 1500) {
    const t = (temperatureK - 320) / (1500 - 320);
    // Blend amber → red across the band.
    const r = Math.round(255);
    const g = Math.round(170 - 130 * t);
    const b = Math.round(60 - 40 * t);
    const alpha = (0.08 + 0.17 * t).toFixed(3);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return "rgba(255, 40, 20, 0.25)";
}

function renderBody(
  topology: VesselTopology | undefined,
  parts: ShipMapPart[],
  highlight: string | null,
  hottestNotCurrent: boolean,
  size: { w: number; h: number },
  setWrapEl: (el: HTMLDivElement | null) => void,
  ambientTint: string | null,
  throttle: number,
  overlayContext: ShipMapOverlayContext | null,
  partMeters: Map<string, ShipMapPartMeterEntry[]>,
  partMeta: Map<string, ShipMapPartMetaEntry[]>,
  onInvokePartAction: (
    flightId: number,
    eventName: string,
    actionLabel: string,
    partTitle: string,
  ) => void,
) {
  if (!topology) {
    return (
      <div style={PLACEHOLDER}>
        Waiting for vessel topology. Check the data source status if this
        persists.
      </div>
    );
  }
  if (parts.length === 0) {
    return <div style={PLACEHOLDER}>Vessel has no parts.</div>;
  }
  return (
    <>
      <div style={META}>
        {parts.length} part{parts.length === 1 ? "" : "s"}
        <span style={META_TAG}>· seq {topology.topologySeq}</span>
        {highlight && <span style={META_TAG}>· hot: {highlight}</span>}
        {/* Only ever one of the two: the observed-only read above has already
            blanked the name on the stale arm. Keeps the tag's slot occupied so
            the missing ring reads as withheld rather than as a craft that
            cooled off. */}
        {hottestNotCurrent && (
          <span style={META_TAG}>· hot: no longer current</span>
        )}
      </div>
      <div ref={setWrapEl} style={DIAGRAM_WRAP}>
        {/* Ambient external-temperature tint. Was a DiagramWrap `::before`
            (not inline-expressible); as an inline style it becomes a real
            child element behind the SVG (z-index 0). */}
        <div
          style={{ ...TINT_LAYER, background: ambientTint ?? "transparent" }}
        />
        <ShipDiagram
          parts={parts}
          highlight={highlight}
          width={size.w}
          height={size.h}
          throttle={throttle}
          partMeters={partMeters}
          partMeta={partMeta}
          onInvokePartAction={onInvokePartAction}
        />
        {overlayContext && (
          <div style={OVERLAY_LAYER}>
            <AugmentSlot name="ship-map.overlay" props={overlayContext} />
          </div>
        )}
      </div>
    </>
  );
}

// Structural inline styles (CSS-var tokens): a bespoke map column, no reusable
// ui-kit primitive fits, so the layout stays local. The one kit piece it reuses
// (Box) takes only this map's column layout inline. The DiagramWrap `::before`
// tint becomes a real child element (see TINT_LAYER); its `svg {}` descendant
// (display/position/z-index) moves onto ShipDiagramSvg's root <svg>.

// A full-height app-surface column, not a widget Panel. The surface is the
// kit's Box; the column and its height are this map's.
const MAP_SURFACE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  boxSizing: "border-box",
};

// The styled version carried a `code {}` rule; no <code> is rendered here, so
// it is dropped rather than reproduced.
const PLACEHOLDER: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-12)",
  textAlign: "center",
};

const META: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-6)",
  padding: "var(--space-4) var(--space-10)",
  background: "var(--color-surface-panel)",
  borderBottom: "1px solid var(--color-surface-raised)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
};

const META_TAG: CSSProperties = { color: "var(--color-text-faint)" };

// Absolutely-positioned layer over the part diagram for `ship-map.overlay`
// augments. Off the app z-index ladder despite the name: these three values
// (2 here, 1 on the svg, 0 on the tint) are local sibling ordering inside
// DiagramWrap, so only their relative order is load-bearing and --z-overlay
// would lift a widget-internal layer over the app's own chrome. Sits above the
// SVG (z-index 1) and the ambient tint (z-index 0), and stays out of the
// diagram's pointer path so an empty slot is visually and interactively inert:
// an overlay augment re-enables pointer events on its own elements when it
// needs them.
const OVERLAY_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  pointerEvents: "none",
};

const DIAGRAM_WRAP: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
  position: "relative",
  background: "var(--color-surface-app)",
};

// Ambient external-temperature tint: sits behind the SVG so per-part heat tints
// render unobstructed on top. Transition smooths the band as temperature ramps
// during a reentry. Off the motion scale on purpose: a reentry temperature
// ramp, not a UI transition (400ms ease-out is visibly not ease, so the
// ease-out -> --ease-standard snap does not reach here). `background` is applied
// at the call site from the live tint.
const TINT_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  transition: "background 400ms ease-out",
  zIndex: 0,
};

registerComponent<ShipMapConfig>({
  id: "ship-map",
  name: "Ship Map",
  description:
    "Part diagram of the active vessel. Renders the assembled-space vessel graph as a 2D side-view: prefab-bounds size, per-part heat tint, fuel-fill bars on tanks and boosters, hottest part highlighted.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 5, h: 5 },
  component: ShipMapComponent,
  // Exposes an overlay slot, drawn over the part diagram and passed the
  // diagram's base-frame projection. No first-party augment fills it yet.
  augmentSlots: ["ship-map.overlay"],
  // The self-contribution slots: per-part resource meters and
  // per-part status/meta rows. The built-in `core` contribution
  // (./partMetersContribution.ts) always fills the first; an Uplink may
  // fill both.
  contributionSlots: ["ship-map.part-meters", "ship-map.part-meta"],
  // useTopology reads the `vessel.parts` stream Topic directly (bypassing
  // the mapTopic shim, same as useVesselDeltaV's stream-native reads); the
  // per-part thermal/resources/module-state joins in usePartsLive all ride
  // the same payload: no per-flightId subscriptions.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
