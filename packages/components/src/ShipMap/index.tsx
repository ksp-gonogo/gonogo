import type {
  ComponentProps,
  ConfigComponentProps,
  VesselTopology,
} from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { usePartsLive } from "@gonogo/data";
import { ConfigForm, Field, FieldHint, FieldLabel } from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ShipDiagram } from "./ShipDiagram";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "./shipTopology";

interface ShipMapConfig {
  /** Reserved — no widget-level options yet. Kept for forward
   *  compatibility so saved layouts don't break when options land. */
  _reserved?: never;
}

function ShipMapComponent(_props: Readonly<ComponentProps<ShipMapConfig>>) {
  const topology = useDataValue("data", "v.topology");
  const hottestPartName = useDataValue("data", "therm.hottestPartName");

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
    return topology.parts.map((p) => {
      const live = liveByFlightId.get(p.flightId);
      return buildShipMapPart(p, live?.thermal, live?.resources, useX);
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

  return (
    <Panel>{renderBody(topology, parts, highlight, size, setWrapEl)}</Panel>
  );
}

function renderBody(
  topology: VesselTopology | undefined,
  parts: ShipMapPart[],
  highlight: string | null,
  size: { w: number; h: number },
  setWrapEl: (el: HTMLDivElement | null) => void,
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
      <DiagramWrap ref={setWrapEl}>
        <ShipDiagram
          parts={parts}
          highlight={highlight}
          width={size.w}
          height={size.h}
        />
      </DiagramWrap>
    </>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

function ShipMapConfigComponent(
  _props: Readonly<ConfigComponentProps<ShipMapConfig>>,
) {
  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Data source</FieldLabel>
        <FieldHint>
          Reads <code>v.topology</code> from Telemachus. The topology snapshot
          is event-invalidated on the server side — the widget refreshes when
          you stage, dock, decouple, or otherwise change the vessel graph; no
          configurable interval.
        </FieldHint>
      </Field>
    </ConfigForm>
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

const DiagramWrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--color-surface-app);
  svg {
    display: block;
    flex: 1;
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
  configComponent: ShipMapConfigComponent,
  openConfigOnAdd: false,
  dataRequirements: ["v.topology", "v.topologySeq", "therm.hottestPartName"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
