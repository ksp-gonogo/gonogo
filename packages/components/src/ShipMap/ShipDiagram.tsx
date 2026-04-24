import { useMemo } from "react";
import styled from "styled-components";
import type { ShipMapPart } from "./shipMapScript";

/**
 * Two-axis SVG projection of the ship. Default view is side-on:
 *   horizontal = x (STAR, +right)
 *   vertical   = -z (FORE flipped so nose points up)
 * Part-to-part lines follow the parent/child tree. A single optional
 * highlight dims every other part and emphasises the matched one.
 */

export interface ShipDiagramProps {
  parts: readonly ShipMapPart[];
  /**
   * Case-insensitive name or title to highlight. Usually
   * `therm.hottestPartName` from Telemachus — matched against both
   * `name` and `title` so mismatched capitalisation or mod-specific
   * naming doesn't silently fail.
   */
  highlight?: string | null;
  /** Optional chrome colour for the highlighted ring. */
  highlightColor?: string;
  width: number;
  height: number;
}

export function ShipDiagram({
  parts,
  highlight,
  highlightColor = "#ff5252",
  width,
  height,
}: ShipDiagramProps) {
  const { projected, bounds, highlightUid } = useMemo(
    () => project(parts, highlight ?? null),
    [parts, highlight],
  );

  if (parts.length === 0) {
    return (
      <Empty>
        No ship data yet. Save the script to <code>shipmap.ks</code> on Archive
        and press Run.
      </Empty>
    );
  }

  // Pad the bounds so points don't sit on the edge.
  const padding = 12;
  const span = Math.max(bounds.w, bounds.h, 1);
  const scale = Math.min(width - padding * 2, height - padding * 2) / span;
  const cx = width / 2;
  const cy = height / 2;

  const toScreen = (px: number, py: number) => ({
    sx: cx + (px - bounds.x - bounds.w / 2) * scale,
    sy: cy + (py - bounds.y - bounds.h / 2) * scale,
  });

  // Parent/child edges — let the user see the attachment tree.
  const uidIndex = new Map(projected.map((p) => [p.uid, p]));
  const edges: Array<{
    a: (typeof projected)[number];
    b: (typeof projected)[number];
  }> = [];
  for (const p of projected) {
    if (!p.parent) continue;
    const parent = uidIndex.get(p.parent);
    if (parent) edges.push({ a: p, b: parent });
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Ship diagram (${parts.length} parts)`}
    >
      <title>Ship diagram ({parts.length} parts)</title>
      {edges.map((e) => {
        const a = toScreen(e.a.px, e.a.py);
        const b = toScreen(e.b.px, e.b.py);
        return (
          <line
            key={`${e.a.uid}-${e.b.uid}`}
            x1={a.sx}
            y1={a.sy}
            x2={b.sx}
            y2={b.sy}
            stroke="#2a2a2a"
            strokeWidth={1}
          />
        );
      })}
      {projected.map((p) => {
        const { sx, sy } = toScreen(p.px, p.py);
        const isHot = p.uid === highlightUid;
        const r = 3 + Math.min(6, Math.sqrt(Math.max(p.mass, 0)) * 1.2);
        return (
          <g key={p.uid}>
            {isHot && (
              <circle
                cx={sx}
                cy={sy}
                r={r + 4}
                fill="none"
                stroke={highlightColor}
                strokeWidth={2}
                opacity={0.9}
              />
            )}
            <circle
              cx={sx}
              cy={sy}
              r={r}
              fill={isHot ? highlightColor : "#4caf50"}
              fillOpacity={isHot ? 1 : highlightUid ? 0.35 : 0.7}
              stroke={isHot ? "#fff" : "#1f1f1f"}
              strokeWidth={1}
            />
          </g>
        );
      })}
    </svg>
  );
}

function project(
  parts: readonly ShipMapPart[],
  highlight: string | null,
): {
  projected: Array<{
    uid: string;
    px: number;
    py: number;
    mass: number;
    parent: string;
  }>;
  bounds: { x: number; y: number; w: number; h: number };
  highlightUid: string | null;
} {
  if (parts.length === 0) {
    return {
      projected: [],
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      highlightUid: null,
    };
  }

  const hl = highlight?.toLowerCase() ?? null;
  let highlightUid: string | null = null;

  // Side-on elevation: horizontal = x (starboard), vertical = -z (flipped so
  // the ship's nose points up). y (top) is ignored in this view; a follow-up
  // can expose a view-mode toggle.
  const projected = parts.map((p) => {
    if (
      hl !== null &&
      highlightUid === null &&
      (p.title.toLowerCase() === hl || p.name.toLowerCase() === hl)
    ) {
      highlightUid = p.uid;
    }
    return {
      uid: p.uid,
      px: p.x,
      py: -p.z,
      mass: p.mass,
      parent: p.parent,
    };
  });

  let minX = projected[0].px;
  let maxX = projected[0].px;
  let minY = projected[0].py;
  let maxY = projected[0].py;
  for (const p of projected) {
    if (p.px < minX) minX = p.px;
    if (p.px > maxX) maxX = p.px;
    if (p.py < minY) minY = p.py;
    if (p.py > maxY) maxY = p.py;
  }

  return {
    projected,
    bounds: {
      x: minX,
      y: minY,
      w: Math.max(maxX - minX, 0.01),
      h: Math.max(maxY - minY, 0.01),
    },
    highlightUid,
  };
}

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: #1a1a1a;
    padding: 1px 4px;
    border-radius: 2px;
    color: #cfe;
  }
`;
