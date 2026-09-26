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
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { Box, usePanelDelay } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
// Side-effect import: registers the built-in `ship-map.part-meters` contribution.
import "./partMetersContribution";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
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
  // Only what the diagram draws: ThermalStatus draws the rest of `vessel.thermal`, and its alarms do not belong here.
  fields: [
    "vessel.parts",
    "vessel.thermal.hottestPart.name",
    "vessel.thermal.hottestPart.id",
    "vessel.flight.externalTemperature",
    "vessel.control.throttle",
  ],
});

// Re-exported from the widget root like every other slot-context type; authored in `shipTopology.ts` to avoid an import cycle.
export type { ShipMapPartMetaEntry, ShipMapPartMeterEntry };

/**
 * Props for `ship-map.overlay`, a layer over the part diagram carrying its
 * base-frame projection. Project a part at metre-space `(lat, axial)` with
 *   x = width / 2 + (lat - bounds.cx) * baseScale
 *   y = height / 2 - (axial - bounds.cy) * baseScale
 * This is the identity-camera frame; the live zoom/pan is not reflected.
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

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "ship-map.overlay": ShipMapOverlayContext;
  }

  // Two typed slots, each fed by the built-in contribution and any Uplink's on equal footing.
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
  /** Reserved so saved layouts survive when options land. */
  _reserved?: never;
}

function ShipMapComponent(_props: Readonly<ComponentProps<ShipMapConfig>>) {
  // The mod's channel engine is change-gated, so no seq-driven refetch is needed.
  const topology = useTopology();
  /**
   * "Hottest part" is a verdict about now, so a held reading draws no ring and
   * the header tag says why, rather than reading as a craft that cooled down.
   */
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const hottestPart =
    thermalReading.state === "observed"
      ? thermalReading.value.hottestPart
      : undefined;
  const hottestNotCurrent = thermalReading.state === "stale";
  // Ambient skin temperature tints the diagram background; a dated number, so the last observation is used.
  const flightReading = topics.useTelemetry("vessel.flight");
  const externalTemperature = magnitudeOf(
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value.externalTemperature
      : undefined,
  );
  // Throttle gates the engine flame: the last confirmed throttle, zero on a cold start.
  const controlReading = topics.useTelemetry("vessel.control");
  const throttle = magnitudeOr(
    controlReading.state === "observed" || controlReading.state === "stale"
      ? controlReading.value.throttle
      : undefined,
    0,
  );

  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);

  // Grouped by partId once, so the in-body bars and the hover tooltip read the same lookup.
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

  // Axis pick happens once per topology rebuild so every part shares one lateral basis.
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

  // A state-backed ref so the effect re-attaches when DiagramWrap mounts, which happens only once topology exists.
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

  // The command handle lives at the always-mounted widget: the menu closes when an action fires, and its in-flight delay row must outlive it.
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
        // The wire keys parts by stringified flightID, the form every cross-channel join uses.
        { partId: String(flightId), eventName },
        // Operator-facing description for the delay readouts: the raw event name alone would not say which part it acts on.
        { label: `${actionLabel} on ${partTitle}` },
      );
    },
    [invokePartAction],
  );

  const hottestName =
    typeof hottestPart?.name === "string" ? hottestPart.name : null;
  const hottestPartId =
    typeof hottestPart?.id === "string" ? hottestPart.id : null;

  const ambientTint = useMemo(
    () => externalTempTint(externalTemperature),
    [externalTemperature],
  );

  // `overlay` is null until parts resolve.
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
        hottestName,
        hottestPartId,
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
 * Groups contribution entries by `partId`, first-wins on `dedupeKey`.
 * `useContributions` returns entries in priority order, so first is the
 * highest-priority contributor.
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
 * Ambient external temperature (kelvin) to a background tint, blue when cold
 * through clear to amber and red. `null` with no signal. Alpha capped at 0.25
 * so per-part heat tints stay visible.
 */
function externalTempTint(temperatureK: number | null): string | null {
  if (temperatureK === null) return null;
  // Anchor points: 200 K = deep cold (subtle blue), 290 K = ambient (clear), 600 K = warning amber, 1500+ K = reentry red.
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
  hottestName: string | null,
  hottestPartId: string | null,
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
        {hottestName && <span style={META_TAG}>· hot: {hottestName}</span>}
        {hottestNotCurrent && (
          <span style={META_TAG}>· hot: no longer current</span>
        )}
      </div>
      <div ref={setWrapEl} style={DIAGRAM_WRAP}>
        {/* Ambient external-temperature tint, behind the SVG. */}
        <div
          style={{ ...TINT_LAYER, background: ambientTint ?? "transparent" }}
        />
        <ShipDiagram
          parts={parts}
          highlightPartId={hottestPartId}
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

// A full-height app-surface column, not a widget Panel.
const MAP_SURFACE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  boxSizing: "border-box",
};

const PLACEHOLDER: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-tile-message)",
  textAlign: "center",
};

const META: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  borderBottom: "1px solid var(--color-surface-raised)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};

const META_TAG: CSSProperties = { color: "var(--color-text-faint)" };

// Over the SVG (1) and tint (0): local sibling ordering inside DiagramWrap, so --z-overlay would wrongly lift it over app chrome. Pointer-inert so an empty slot is inert; an augment re-enables pointer events on its own elements.
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

// Behind the SVG so per-part heat tints render on top. The transition is a reentry ramp, not a UI transition, so it is off the motion scale.
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
  augmentSlots: ["ship-map.overlay"],
  // The built-in contribution always fills part-meters; an Uplink may fill both.
  contributionSlots: ["ship-map.part-meters", "ship-map.part-meta"],
  // Per-part thermal, resources and module state all ride the one `vessel.parts` payload.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
