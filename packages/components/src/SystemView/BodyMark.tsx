import { getBody } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PlacedBody, PlacedPoint } from "./diagramGeometry";
import { DepthRing } from "./diagramMarks";
import { normalizePhaseAngle } from "./transferWindow";
import type { CelestialBody } from "./useCelestialBodies";

/** How a body's dot and label are emphasised: the selected target, the vessel's own body, or neither. */
export type BodyTone = "target" | "highlighted" | "plain";

export function bodyTone(isTarget: boolean, isHighlighted: boolean): BodyTone {
  if (isTarget) return "target";
  if (isHighlighted) return "highlighted";
  return "plain";
}

const DOT_RADIUS: Record<BodyTone, number> = {
  target: 6,
  highlighted: 5,
  plain: 4,
};

function dotFill(tone: BodyTone, body: CelestialBody): string {
  if (tone === "target") return "var(--color-status-nogo-bg)";
  if (tone === "highlighted") return "var(--color-accent-fg)";
  const stockColor = body.name ? getBody(body.name)?.color : undefined;
  return stockColor ?? "var(--color-status-info-fg)";
}

function labelFill(tone: BodyTone): string {
  if (tone === "target") return "var(--color-status-nogo-bg)";
  if (tone === "highlighted") return "var(--color-accent-fg)";
  return "var(--color-text-primary)";
}

function phaseFill(status: "go" | "soon" | undefined): string {
  if (status === "go") return "var(--color-status-go-fg)";
  if (status === "soon") return "var(--color-status-warning-bg)";
  return "var(--color-text-faint)";
}

/** One child body: its depth ring, its dot, and a name and phase-angle label unless it sits on the parent. */
export function BodyMark({
  placed,
  parentAt,
  zoom,
  tone,
  phaseAngle,
  transferStatus,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
}: Readonly<{
  placed: PlacedBody;
  parentAt: PlacedPoint;
  zoom: number;
  tone: BodyTone;
  /** Live phase angle to the active vessel, degrees; absent draws no phase label. */
  phaseAngle: number | undefined;
  transferStatus: "go" | "soon" | undefined;
  onHoverStart: (body: CelestialBody, e: ReactPointerEvent) => void;
  onHoverMove: (body: CelestialBody, e: ReactPointerEvent) => void;
  onHoverEnd: () => void;
}>) {
  const c = placed.body;
  if ((c.semiMajorAxis ?? 0) <= 0) return null;
  const depthPx = placed.depthUnits * zoom;
  const dotR = DOT_RADIUS[tone] / zoom;
  // Measured from the parent's drawn position: a child this close would print its label over the parent's.
  const screenDistFromParent =
    Math.hypot(placed.x - parentAt.x, placed.y - parentAt.y) * zoom;
  const labelWouldCollideWithParent = screenDistFromParent < 30;
  return (
    <g>
      <DepthRing
        cx={placed.x}
        cy={placed.y}
        radius={dotR * 1.9}
        depthPx={depthPx}
        zoom={zoom}
      />
      <circle
        data-body={c.name ?? ""}
        data-depth-px={depthPx}
        cx={placed.x}
        cy={placed.y}
        r={dotR}
        fill={dotFill(tone, c)}
        stroke="var(--color-text-inverse)"
        strokeWidth={1 / zoom}
        onPointerEnter={(e) => onHoverStart(c, e)}
        onPointerMove={(e) => onHoverMove(c, e)}
        onPointerLeave={onHoverEnd}
        style={{ cursor: "pointer" }}
      />
      {!labelWouldCollideWithParent && (
        <text
          x={placed.x + dotR + 3 / zoom}
          y={placed.y + 3 / zoom}
          fill={labelFill(tone)}
          fontSize={10 / zoom}
          pointerEvents="none"
        >
          {c.name ?? NULL_DISPLAY}
        </text>
      )}
      {!labelWouldCollideWithParent && phaseAngle !== undefined && (
        <text
          x={placed.x + dotR + 3 / zoom}
          y={placed.y + 14 / zoom}
          fill={phaseFill(transferStatus)}
          fontSize={8 / zoom}
          fontWeight={transferStatus === "go" ? 700 : 400}
          pointerEvents="none"
        >
          {writeQuantity(value("°", normalizePhaseAngle(phaseAngle)), {
            decimals: 0,
          })}
        </text>
      )}
    </g>
  );
}
