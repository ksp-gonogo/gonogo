import type { ComponentProps, VesselTopology } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { usePartsLive, useTopology } from "@gonogo/data";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ShipDiagram } from "./ShipDiagram";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "./shipTopology";

interface ShipMapConfig {
  /** Reserved. No widget-level options yet; kept for forward
   *  compatibility so saved layouts don't break when options land. */
  _reserved?: never;
}

function ShipMapComponent(_props: Readonly<ComponentProps<ShipMapConfig>>) {
  // Seq-driven topology refetch — subscribes to the lightweight
  // v.topologySeq int continuously, fetches v.topology only when the seq
  // bumps. Keeps steady-state wire bytes minimal on a stable vessel.
  const topology = useTopology("data");
  const hottestPartName = useDataValue("data", "therm.hottestPartName");
  // Ambient skin temperature — drives a background tint on the diagram so
  // the operator can see reentry heating at a glance. Per-part heat tints
  // still show on top.
  const externalTemperature = useDataValue("data", "v.externalTemperature");
  // Current throttle — gates the engine-flame overlay so a staged-but-
  // idle engine doesn't render thrust. Forwarded through ShipDiagram
  // to ShipDiagramSvg.
  const throttleRaw = useDataValue<number>("data", "f.throttle");
  const throttle =
    typeof throttleRaw === "number" && Number.isFinite(throttleRaw)
      ? throttleRaw
      : 0;

  // Subscribe to per-part live data (resources + thermal). Dynamic over
  // the topology's part list — the hook re-subscribes when the set of
  // flightIds changes.
  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);

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
  // when DiagramWrap mounts — it's only rendered once topology exists, so
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

  const highlight =
    typeof hottestPartName === "string" ? hottestPartName : null;

  const ambientTint = useMemo(
    () => externalTempTint(externalTemperature),
    [externalTemperature],
  );

  return (
    <Panel>
      {renderBody(
        topology,
        parts,
        highlight,
        size,
        setWrapEl,
        ambientTint,
        throttle,
      )}
    </Panel>
  );
}

/**
 * Map ambient external temperature (kelvin) to an rgba string that fades
 * the diagram background blue (cold) → transparent → amber → red as the
 * vessel heats up. Returns `null` when there's no signal — the styled
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
  size: { w: number; h: number },
  setWrapEl: (el: HTMLDivElement | null) => void,
  ambientTint: string | null,
  throttle: number,
) {
  if (!topology) {
    return (
      <Placeholder>
        Waiting for vessel topology from Telemachus. Check the data source
        status if this persists.
      </Placeholder>
    );
  }
  if (parts.length === 0) {
    return <Placeholder>Vessel has no parts.</Placeholder>;
  }
  return (
    <>
      <Meta>
        {parts.length} part{parts.length === 1 ? "" : "s"}
        <MetaTag>· seq {topology.topologySeq}</MetaTag>
        {highlight && <MetaTag>· hot: {highlight}</MetaTag>}
      </Meta>
      <DiagramWrap ref={setWrapEl} $tint={ambientTint}>
        <ShipDiagram
          parts={parts}
          highlight={highlight}
          width={size.w}
          height={size.h}
          throttle={throttle}
        />
      </DiagramWrap>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  background: var(--color-surface-app);
`;

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: var(--color-surface-raised);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--color-status-go-fg);
  }
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const MetaTag = styled.span`
  color: var(--color-text-faint);
`;

const DiagramWrap = styled.div<{ $tint: string | null }>`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  position: relative;
  background: var(--color-surface-app);
  svg {
    display: block;
    flex: 1;
    position: relative;
    z-index: 1;
  }
  /* Ambient external-temperature tint — sits behind the SVG so per-part
     heat tints render unobstructed on top. Transition smooths the band
     as temperature ramps during a reentry. */
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: ${({ $tint }) => $tint ?? "transparent"};
    transition: background 400ms ease-out;
    z-index: 0;
  }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ShipMapConfig>({
  id: "ship-map",
  name: "Ship Map",
  description:
    "Part diagram of the active vessel, driven by Telemachus v.topology. Renders the assembled-space vessel graph as a 2D side-view: prefab-bounds size, per-part heat tint, fuel-fill bars on tanks and boosters, hottest part highlighted.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 5, h: 5 },
  component: ShipMapComponent,
  // useTopology internally subscribes to v.topologySeq + briefly to
  // v.topology on bump; per-part live data joins via usePartsLive.
  dataRequirements: [
    "v.topologySeq",
    "v.topology",
    "therm.hottestPartName",
    "v.externalTemperature",
    "f.throttle",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
