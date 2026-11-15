import {
  AugmentSlot,
  type CrashReportOfEnding,
  type VesselTopology,
} from "@ksp-gonogo/core";
import type { AnyBoundCommand } from "@ksp-gonogo/sitrep-sdk";
import { FramedDisplay, Section } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { DestroyedCraft } from "./DestroyedCraft";
import type { TransferResourceOption } from "./PartActionMenu";
import { ShipDiagram } from "./ShipDiagram";
import { StageColumn } from "./StageColumn";
import type {
  ShipMapPart,
  ShipMapPartActionEntry,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";
import type { ShipMapOverlayContext } from "./slots";
import type { StageEntry } from "./stageStack";
import type { TransferDrawing } from "./TransferLayer";

export type PartActionCommand = (
  flightId: number,
  eventName: string,
  actionLabel: string,
  partTitle: string,
) => AnyBoundCommand;

/** The Panel sections of the map: the tinted diagram in its frame with its overlay slot, or a placeholder until there are parts to draw. */
export function shipMapSections({
  topology,
  parts,
  hottestPartId,
  size,
  setWrapEl,
  ambientTint,
  throttle,
  thrusting,
  overlayContext,
  partMeters,
  partMeta,
  partActions,
  contributedActionCommand,
  partActionCommand,
  turn,
  onTurn,
  stages,
  stagesOnly,
  destroyed,
  transferTray,
  transferDrawing,
  onPickTank,
  transferResourcesOf,
  onStartTransferPick,
}: {
  topology: VesselTopology | undefined;
  parts: ShipMapPart[];
  hottestPartId: string | null;
  size: { w: number; h: number };
  setWrapEl: (el: HTMLDivElement | null) => void;
  ambientTint: string | null;
  throttle: number;
  thrusting: boolean;
  overlayContext: ShipMapOverlayContext | null;
  partMeters: Map<string, ShipMapPartMeterEntry[]>;
  partMeta: Map<string, ShipMapPartMetaEntry[]>;
  partActions: Map<string, ShipMapPartActionEntry[]>;
  contributedActionCommand: (
    entry: ShipMapPartActionEntry,
    partTitle: string,
  ) => AnyBoundCommand | null;
  partActionCommand: PartActionCommand;
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
  /** The transfer tray: the pick in progress and running transfers. Null when neither. */
  transferTray: ReactNode;
  transferDrawing?: TransferDrawing;
  onPickTank?: (part: ShipMapPart) => void;
  transferResourcesOf?: (
    part: ShipMapPart,
  ) => readonly TransferResourceOption[];
  onStartTransferPick?: (part: ShipMapPart, resource: string) => void;
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
            thrusting={thrusting}
            partMeters={partMeters}
            partMeta={partMeta}
            partActions={partActions}
            contributedActionCommand={contributedActionCommand}
            partActionCommand={partActionCommand}
            turn={turn}
            onTurn={onTurn}
            transferDrawing={transferDrawing}
            onPickTank={onPickTank}
            transferResourcesOf={transferResourcesOf}
            onStartTransferPick={onStartTransferPick}
          />
          {overlayContext && (
            <div style={OVERLAY_LAYER}>
              <AugmentSlot name="ship-map.overlay" props={overlayContext} />
            </div>
          )}
        </div>
      </FramedDisplay>
    </Section>,
    transferTray != null && (
      <Section key="transfer" full>
        {transferTray}
      </Section>
    ),
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
