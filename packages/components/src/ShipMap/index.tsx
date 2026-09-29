import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useContributions,
} from "@ksp-gonogo/core";
import { usePartsLive, useTopology } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { Box } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
// Side-effect import: registers the built-in `ship-map.part-meters` contribution.
import "./partMetersContribution";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import { externalTempTint } from "./ambientTint";
import { groupByPart } from "./groupByPart";
import { INVOKE_PART_ACTION_COMMAND } from "./PartActionMenu";
import { ShipMapBody } from "./ShipMapBody";
import { computeShipLayout } from "./shipLayout";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
  type ShipMapPartMetaEntry,
  type ShipMapPartMeterEntry,
} from "./shipTopology";
import type { ShipMapOverlayContext } from "./slots";

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
    "vessel.thermal.hottestPart.internalTemp",
    "vessel.flight.externalTemperature",
    "vessel.control.throttle",
  ],
});

export type { ShipMapOverlayContext } from "./slots";
// Re-exported from the widget root like every other slot-context type; authored in `shipTopology.ts` to avoid an import cycle.
export type { ShipMapPartMetaEntry, ShipMapPartMeterEntry };

interface ShipMapConfig {
  /** Reserved so saved layouts survive when options land. */
  _reserved?: never;
}

function ShipMapComponent(_props: Readonly<ComponentProps<ShipMapConfig>>) {
  // The mod's channel engine is change-gated, so no seq-driven refetch is needed.
  const topology = useTopology();
  /**
   * "Hottest part" is a verdict about now, so only a current reading rings the
   * part; the header keeps the last one, its temperature marked held by Unit.
   */
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const hottestPart =
    thermalReading.state === "observed" || thermalReading.state === "held"
      ? thermalReading.value.hottestPart
      : undefined;
  const hottestTemp = thermalReading.hottestPart.internalTemp;
  // Ambient skin temperature tints the diagram background; a dated number, so the last observation is used.
  const flightReading = topics.useTelemetry("vessel.flight");
  const externalTemperature = magnitudeOf(
    flightReading.state === "observed" || flightReading.state === "held"
      ? flightReading.value.externalTemperature
      : undefined,
  );
  // Throttle gates the engine flame: the last confirmed throttle, zero on a cold start.
  const controlReading = topics.useTelemetry("vessel.control");
  const throttle = magnitudeOr(
    controlReading.state === "observed" || controlReading.state === "held"
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
    thermalReading.state === "observed" && typeof hottestPart?.id === "string"
      ? hottestPart.id
      : null;

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
      <ShipMapBody
        topology={topology}
        parts={parts}
        hottestName={hottestName}
        hottestPartId={hottestPartId}
        hottestTemp={hottestTemp}
        size={size}
        setWrapEl={setWrapEl}
        ambientTint={ambientTint}
        throttle={throttle}
        overlayContext={overlayContext}
        partMeters={partMeters}
        partMeta={partMeta}
        onInvokePartAction={onInvokePartAction}
      />
    </Box>
  );
}

// A full-height app-surface column, not a widget Panel.
const MAP_SURFACE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  boxSizing: "border-box",
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
