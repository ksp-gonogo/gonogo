import {
  AugmentSlot,
  type CrashReportOfEnding,
  type VesselTopology,
} from "@ksp-gonogo/core";
import { FramedDisplay, Section } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { DestroyedCraft } from "./DestroyedCraft";
import { ShipDiagram } from "./ShipDiagram";
import { StageColumn } from "./StageColumn";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";
import type { ShipMapOverlayContext } from "./slots";
import type { StageEntry } from "./stageStack";

export type InvokePartAction = (
  flightId: number,
  eventName: string,
  actionLabel: string,
  partTitle: string,
) => void;

/** The Panel sections of the map: the tinted diagram in its frame with its overlay slot, or a placeholder until there are parts to draw. */
export function shipMapSections({
  topology,
  parts,
  hottestPartId,
  size,
  setWrapEl,
  ambientTint,
  throttle,
  overlayContext,
  partMeters,
  partMeta,
  onInvokePartAction,
  turn,
  onTurn,
  stages,
  stagesOnly,
  destroyed,
}: {
  topology: VesselTopology | undefined;
  parts: ShipMapPart[];
  hottestPartId: string | null;
  size: { w: number; h: number };
  setWrapEl: (el: HTMLDivElement | null) => void;
  ambientTint: string | null;
  throttle: number;
  overlayContext: ShipMapOverlayContext | null;
  partMeters: Map<string, ShipMapPartMeterEntry[]>;
  partMeta: Map<string, ShipMapPartMetaEntry[]>;
  onInvokePartAction: InvokePartAction;
  /** Presses of the rotate control the view is turned from its default. */
  turn: number;
  /** Sets the number of presses the view is turned from its default. */
  onTurn: (turn: number) => void;
  /** The staging stack still to fire; empty when no part carries a stage. */
  stages: StageEntry[];
  /** True on a tile narrow enough that the stage list takes the whole body and the diagram is not drawn. */
  stagesOnly: boolean;
  /** The crash report of the craft this map showed, once that craft is destroyed. */
  destroyed: CrashReportOfEnding | undefined;
}): ReactNode[] {
  const listOnly = stagesOnly && stages.length > 0;
  if (!topology) {
    return [
      <Section key="message" full>
        {destroyed ? (
          <DestroyedCraft crash={destroyed} />
        ) : (
          <div style={PLACEHOLDER}>
            Waiting for vessel topology. Check the data source status if this
            persists.
          </div>
        )}
      </Section>,
    ];
  }
  if (parts.length === 0) {
    return [
      <Section key="message" full>
        <div style={PLACEHOLDER}>Vessel has no parts.</div>
      </Section>,
    ];
  }
  if (listOnly) {
    return [
      <Section key="stages" fill>
        <StageColumn stages={stages} fill />
      </Section>,
    ];
  }
  return [
    <Section key="diagram" fill>
      <FramedDisplay style={FRAME}>
        <div ref={setWrapEl} style={DIAGRAM_WRAP}>
          {/* Ambient external-temperature tint, behind the SVG. */}
          <div
            style={{
              ...TINT_LAYER,
              background: ambientTint ?? "transparent",
            }}
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
            turn={turn}
            onTurn={onTurn}
          />
          {overlayContext && (
            <div style={OVERLAY_LAYER}>
              <AugmentSlot name="ship-map.overlay" props={overlayContext} />
            </div>
          )}
        </div>
      </FramedDisplay>
    </Section>,
  ];
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

// Over the SVG (1) and tint (0): local sibling ordering inside DiagramWrap, so --z-overlay would wrongly lift it over app chrome. Pointer-inert so an empty slot is inert; an augment re-enables pointer events on its own elements.
const OVERLAY_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  pointerEvents: "none",
};

// The frame takes the room the body has; the stage list is the panel sidebar, so the diagram never shares a row with it.
const FRAME: CSSProperties = { flex: 1, minHeight: 0, position: "relative" };

const DIAGRAM_WRAP: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
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
