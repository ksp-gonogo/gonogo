import { AugmentSlot, type VesselTopology } from "@ksp-gonogo/core";
import { Unit } from "@ksp-gonogo/ui-kit";
import type { ComponentProps, CSSProperties } from "react";
import { ShipDiagram } from "./ShipDiagram";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";
import type { ShipMapOverlayContext } from "./slots";

export type InvokePartAction = (
  flightId: number,
  eventName: string,
  actionLabel: string,
  partTitle: string,
) => void;

/** The header, the tinted diagram and its overlay slot, or a placeholder until there are parts to draw. */
export function ShipMapBody({
  topology,
  parts,
  hottestName,
  hottestPartId,
  hottestTemp,
  size,
  setWrapEl,
  ambientTint,
  throttle,
  overlayContext,
  partMeters,
  partMeta,
  onInvokePartAction,
}: {
  topology: VesselTopology | undefined;
  parts: ShipMapPart[];
  hottestName: string | null;
  hottestPartId: string | null;
  /** The hottest part's internal temperature, as the reading it arrived in. */
  hottestTemp: ComponentProps<typeof Unit>["value"];
  size: { w: number; h: number };
  setWrapEl: (el: HTMLDivElement | null) => void;
  ambientTint: string | null;
  throttle: number;
  overlayContext: ShipMapOverlayContext | null;
  partMeters: Map<string, ShipMapPartMeterEntry[]>;
  partMeta: Map<string, ShipMapPartMetaEntry[]>;
  onInvokePartAction: InvokePartAction;
}) {
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
        {hottestName && (
          <span style={META_TAG}>
            · hot: {hottestName} <Unit value={hottestTemp} decimals={0} />
          </span>
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
