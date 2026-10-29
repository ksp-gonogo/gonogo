import type React from "react";
// SVG <g> focus ring via `:focus-visible`, which inline style and no ui-kit primitive can express.
// biome-ignore lint/style/noRestrictedImports: SVG <g> focus ring, no inline/primitive equivalent (see above)
import { styled } from "styled-components";
import { chuteStateOf } from "./partChute";
import { partAriaLabel, renderResourceFill } from "./partMeters";
import { renderPartStateOverlays } from "./partOverlays";
import {
  colorFor,
  heatTintFor,
  type PartMarks,
  renderPartShape,
} from "./partShape";
import type { ShipDiagramSvgProps } from "./ShipDiagramSvg";
import type { ProjectedPart } from "./shipLayout";
import type { ShipMapPartMeterEntry } from "./shipTopology";

/** One part: its shape, live-state overlays, heat tint, fuel bars, EC-flow and hottest rings, and, when interactive, its focus ring and handlers. */
export function ShipPartGroup({
  p,
  toBase,
  cam,
  highlightPartId,
  highlightColor,
  throttle,
  meters,
  heldHatchId,
  interactive,
  onPartHover,
  onPartFocus,
  onPartActivate,
}: {
  p: ProjectedPart;
  toBase: (lat: number, axial: number) => { x: number; y: number };
  cam: NonNullable<ShipDiagramSvgProps["cam"]>;
  highlightPartId: ShipDiagramSvgProps["highlightPartId"];
  highlightColor: string;
  throttle: number;
  meters: readonly ShipMapPartMeterEntry[];
  /** The id of the diagram's held hatch `<pattern>`. */
  heldHatchId: string;
  interactive: boolean;
  onPartHover: ShipDiagramSvgProps["onPartHover"];
  onPartFocus: ShipDiagramSvgProps["onPartFocus"];
  onPartActivate: ShipDiagramSvgProps["onPartActivate"];
}) {
  const stroke = (n: number) => n / cam.zoom;
  const isHot =
    highlightPartId != null && String(p.flightId) === highlightPartId;
  const fill = colorFor(p.type);
  const tint = heatTintFor(p.temperatureK, p.maxTemperatureK ?? p.maxTemp);
  const a = toBase(p.body.latMin, p.body.axialMax);
  const c = toBase(p.body.latMax, p.body.axialMin);
  const box = {
    x: Math.min(a.x, c.x),
    y: Math.min(a.y, c.y),
    w: Math.abs(c.x - a.x),
    h: Math.abs(c.y - a.y),
  };
  const center = toBase(p.lat, p.axial);
  const outerSign = p.tipSign ?? (p.lat >= 0 ? 1 : -1);
  const shapeType = p.type === "fin" && p.tipSign == null ? "other" : p.type;
  const gearDown = !p.partState?.some(
    (m) =>
      m.type === "landingGear" &&
      (m.state === "retracted" || m.state === "retracting"),
  );
  const pxPerMetre = Math.abs(toBase(1, 0).x - toBase(0, 0).x);
  // A point in the drawn box's frame, in metres from its centre with y up, as a point in the diagram.
  const inBox = (x: number, y: number) => ({
    x: center.x + x * pxPerMetre,
    y: center.y - y * pxPerMetre,
  });
  const marks: PartMarks = {};
  if (p.stowedStrut) {
    const from = inBox(p.stowedStrut.x1, p.stowedStrut.y1);
    const to = inBox(p.stowedStrut.x2, p.stowedStrut.y2);
    marks.stowedStrut = {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      width: p.stowedStrut.width * pxPerMetre,
    };
  }
  if (p.shapeDrawing) {
    marks.shape = { drawing: p.shapeDrawing, center, pxPerMetre };
  }
  if (p.silhouette) {
    marks.silhouette = p.silhouette.map((outline) =>
      outline.map((q) => inBox(q.x, q.y)),
    );
  }
  if (p.anchor) marks.anchor = inBox(p.anchor.x, p.anchor.y);
  const showFuel = p.type === "tank" || p.type === "booster";

  // Screen-space centre of this part, the anchor for the focus tooltip and the action popover.
  const anchor = {
    x: center.x * cam.zoom + cam.panX,
    y: center.y * cam.zoom + cam.panY,
  };

  const interactiveProps = interactive
    ? {
        tabIndex: 0,
        role: "button",
        "aria-label": partAriaLabel(p, meters),
        onPointerEnter: () => onPartHover?.(p),
        onPointerLeave: () => onPartHover?.(null),
        onFocus: () => {
          onPartFocus?.(p, anchor);
          onPartHover?.(p);
        },
        onBlur: () => onPartHover?.(null),
        onClick: () => onPartActivate?.(p, anchor),
        // Right click opens the same menu, with the browser's own context menu suppressed.
        onContextMenu: (e: React.MouseEvent) => {
          if (!onPartActivate) return;
          e.preventDefault();
          onPartActivate(p, anchor);
        },
        // A <g role="button"> gets no native keyboard activation, so Enter/Space are wired here.
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPartActivate?.(p, anchor);
          }
        },
        style: { cursor: "pointer" as const },
      }
    : {};

  const rotateTransform = partTransform(p, center);

  return (
    <PartGroup transform={rotateTransform} {...interactiveProps}>
      {renderPartShape(
        shapeType,
        box,
        center,
        fill,
        isHot,
        cam.zoom,
        outerSign,
        chuteStateOf(p.partState),
        gearDown,
        marks,
        p.trailingCut,
      )}
      {renderPartStateOverlays(p.partState, box, cam.zoom, throttle)}
      {tint && (
        <rect
          data-role="heat-tint"
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          fill={tint.color}
          opacity={tint.opacity}
          pointerEvents="none"
        />
      )}
      {showFuel && renderResourceFill(meters, box, heldHatchId)}
      {p.ecFlowSign && !isHot && (
        <rect
          data-role="ec-flow-ring"
          x={box.x - 1}
          y={box.y - 1}
          width={box.w + 2}
          height={box.h + 2}
          fill="none"
          stroke={
            p.ecFlowSign === "producer"
              ? "var(--color-go-text)"
              : "var(--color-warn-mark)"
          }
          strokeWidth={stroke(1)}
          opacity={0.5}
          rx={2}
        />
      )}
      {isHot && (
        <rect
          data-role="highlight-ring"
          data-part-id={p.flightId}
          x={box.x - 2}
          y={box.y - 2}
          width={box.w + 4}
          height={box.h + 4}
          fill="none"
          stroke={highlightColor}
          strokeWidth={stroke(2)}
          opacity={0.9}
          rx={3}
        />
      )}
      {interactive && (
        <rect
          className="focus-ring"
          x={box.x - 3}
          y={box.y - 3}
          width={box.w + 6}
          height={box.h + 6}
          fill="none"
          stroke="var(--color-focus)"
          strokeWidth={stroke(2)}
          rx={3}
          pointerEvents="none"
        />
      )}
    </PartGroup>
  );
}

/**
 * Solar panels skew rather than rotate, up to 45 degrees: a flat panel
 * seen at an angle projects to a parallelogram with level top and
 * bottom edges. Past 45 degrees the shear blows up toward tan(90) and
 * the panel is really mounted sideways, so it rotates like every other
 * part, whose box and overlays stay locked together.
 */
function partTransform(
  p: ProjectedPart,
  center: { x: number; y: number },
): string | undefined {
  const rotateDeg = (p.rotationRad * 180) / Math.PI;
  if (Math.abs(rotateDeg) <= 0.01) return undefined;
  const cx = center.x.toFixed(2);
  const cy = center.y.toFixed(2);
  if (p.type === "solar" && Math.abs(rotateDeg) <= 45) {
    return `translate(${cx} ${cy}) skewX(${(-rotateDeg).toFixed(2)}) translate(${(-center.x).toFixed(2)} ${(-center.y).toFixed(2)})`;
  }
  return `rotate(${rotateDeg.toFixed(2)} ${cx} ${cy})`;
}

export const PartGroup = styled.g`
  outline: none;
  .focus-ring {
    visibility: hidden;
  }
  &:focus-visible .focus-ring {
    visibility: visible;
  }
`;
