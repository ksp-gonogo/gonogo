import { useEffect, useRef } from "react";
import type { DenseCluster } from "./denseCluster";
import { chuteStateOf } from "./partChute";
import { colorFor, renderPartShape } from "./partShape";
import { PartGroup } from "./ShipPartGroup";
import type { ProjectedPart } from "./shipLayout";

const ICON_RADIUS = 10;
const TILE_W = 112;
const TILE_H = 92;
const TILE_GAP = 6;
const COLUMNS = 2;
const BOX_PAD = 8;
const TITLE_H = 24;

interface Point {
  x: number;
  y: number;
}

/**
 * The expand icons beside each dense cluster of radial parts and, for the open
 * one, a box at the side of the view laying every part of it out at its own
 * proportions, each with a leader line to where it sits on the craft. Drawn in
 * screen space so it stays one size however far the view is zoomed. Used by the
 * Ship Map for rings of parts too crowded to tell apart in place.
 */
export function ClusterLayer({
  clusters,
  toScreen,
  width,
  height,
  openId,
  onToggle,
}: {
  clusters: readonly DenseCluster[];
  /** A metre-space lateral and axial position as a point in the SVG's own pixels. */
  toScreen: (lat: number, axial: number) => Point;
  width: number;
  height: number;
  openId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const iconRefs = useRef(new Map<string, SVGGElement>());
  const open = clusters.find((c) => c.id === openId);
  const close = () => {
    onToggle(null);
    if (open) iconRefs.current.get(open.id)?.focus();
  };
  return (
    <g data-role="cluster-layer">
      {open && (
        <ClusterBox
          cluster={open}
          toScreen={toScreen}
          width={width}
          height={height}
          onClose={close}
        />
      )}
      {clusters.map((c) => {
        const at = toScreen(c.latMax, c.axialMax);
        const cx = Math.min(width - ICON_RADIUS - 2, at.x + ICON_RADIUS + 4);
        const cy = Math.max(ICON_RADIUS + 2, at.y);
        const isOpen = c.id === openId;
        const activate = () => onToggle(isOpen ? null : c.id);
        return (
          <PartGroup
            key={c.id}
            ref={(el: SVGGElement | null) => {
              if (el) iconRefs.current.set(c.id, el);
              else iconRefs.current.delete(c.id);
            }}
            data-role="cluster-expand"
            role="button"
            tabIndex={0}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Close" : "Expand"} the ${c.members.length} parts clustered here`}
            style={{ cursor: "pointer" }}
            onClick={activate}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              activate();
            }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={ICON_RADIUS}
              fill="var(--color-surface-raised)"
              stroke="var(--color-go-text)"
              strokeWidth={1}
            />
            <ExpandGlyph cx={cx} cy={cy} open={isOpen} />
            <circle
              className="focus-ring"
              visibility="hidden"
              cx={cx}
              cy={cy}
              r={ICON_RADIUS + 3}
              fill="none"
              stroke="var(--color-focus)"
              strokeWidth={2}
            />
            <title>{`${c.members.length} parts clustered here`}</title>
          </PartGroup>
        );
      })}
    </g>
  );
}

/** Two corner arrows pointing outward, or inward while the box is open. */
function ExpandGlyph({
  cx,
  cy,
  open,
}: {
  cx: number;
  cy: number;
  open: boolean;
}) {
  const s = open ? 2 : 5;
  const e = open ? 5 : 2;
  const corner = (dx: number, dy: number) =>
    `M ${cx + dx * s},${cy + dy * s} L ${cx + dx * e},${cy + dy * e}`;
  return (
    <path
      d={`${corner(1, -1)} ${corner(-1, 1)}`}
      stroke="var(--color-go-text)"
      strokeWidth={1.5}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function ClusterBox({
  cluster,
  toScreen,
  width,
  height,
  onClose,
}: {
  cluster: DenseCluster;
  toScreen: ClusterLayerProps["toScreen"];
  width: number;
  height: number;
  onClose: () => void;
}) {
  const closeRef = useRef<SVGGElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const members = [...cluster.members].sort(
    (a, b) => a.lat - b.lat || b.axial - a.axial,
  );
  const rows = Math.ceil(members.length / COLUMNS);
  const boxW = COLUMNS * TILE_W + (COLUMNS - 1) * TILE_GAP + BOX_PAD * 2;
  const boxH = TITLE_H + rows * TILE_H + (rows - 1) * TILE_GAP + BOX_PAD * 2;
  const centre = toScreen(
    (cluster.latMin + cluster.latMax) / 2,
    (cluster.axialMin + cluster.axialMax) / 2,
  );
  const boxX = centre.x < width / 2 ? width - boxW - 6 : 6;
  const boxY = Math.max(6, Math.min(height - boxH - 6, 6));
  return (
    <g data-role="cluster-box">
      <title>{`The ${members.length} clustered parts, laid out`}</title>
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={6}
        fill="var(--color-surface-sunken)"
        stroke="var(--color-border-strong)"
      />
      <text
        x={boxX + BOX_PAD}
        y={boxY + 17}
        fill="var(--color-text-primary)"
        fontSize={11}
      >
        {`${members.length} parts`}
      </text>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button> */}
      <g
        ref={closeRef}
        role="button"
        tabIndex={0}
        aria-label="Close the expanded parts"
        style={{ cursor: "pointer", outline: "none" }}
        onClick={onClose}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
          e.preventDefault();
          onClose();
        }}
      >
        <rect
          x={boxX + boxW - 24}
          y={boxY + 4}
          width={18}
          height={18}
          rx={3}
          fill="var(--color-surface-raised)"
          stroke="var(--color-go-text)"
        />
        <path
          d={`M ${boxX + boxW - 19},${boxY + 9} l 8,8 M ${boxX + boxW - 11},${boxY + 9} l -8,8`}
          stroke="var(--color-go-text)"
          strokeWidth={1.5}
        />
      </g>
      {members.map((p, i) => {
        const tileX = boxX + BOX_PAD + (i % COLUMNS) * (TILE_W + TILE_GAP);
        const tileY =
          boxY +
          TITLE_H +
          BOX_PAD +
          Math.floor(i / COLUMNS) * (TILE_H + TILE_GAP);
        const anchorX = boxX < width / 2 ? tileX + TILE_W : tileX;
        return (
          <MemberTile
            key={p.flightId}
            part={p}
            tile={{ x: tileX, y: tileY }}
            leaderFrom={{ x: anchorX, y: tileY + TILE_H / 2 }}
            leaderTo={toScreen(p.lat, p.axial)}
          />
        );
      })}
    </g>
  );
}

type ClusterLayerProps = Parameters<typeof ClusterLayer>[0];

function MemberTile({
  part: p,
  tile,
  leaderFrom,
  leaderTo,
}: {
  part: ProjectedPart;
  tile: Point;
  leaderFrom: Point;
  leaderTo: Point;
}) {
  const pw = Math.max(p.body.latMax - p.body.latMin, 1e-3);
  const ph = Math.max(p.body.axialMax - p.body.axialMin, 1e-3);
  const scale = Math.min((TILE_W - 24) / pw, (TILE_H - 34) / ph);
  const w = pw * scale;
  const h = ph * scale;
  const box = { x: tile.x + (TILE_W - w) / 2, y: tile.y + 8, w, h };
  const label = p.title || p.name;
  return (
    <g data-role="cluster-member" data-part-id={p.flightId}>
      <line
        x1={leaderFrom.x}
        y1={leaderFrom.y}
        x2={leaderTo.x}
        y2={leaderTo.y}
        stroke="var(--color-accent-fg)"
        strokeWidth={0.8}
        opacity={0.75}
        pointerEvents="none"
      />
      <circle
        cx={leaderTo.x}
        cy={leaderTo.y}
        r={2.5}
        fill="var(--color-accent-fg)"
        pointerEvents="none"
      />
      <rect
        x={tile.x}
        y={tile.y}
        width={TILE_W}
        height={TILE_H}
        rx={4}
        fill="var(--color-surface-raised)"
        stroke="var(--color-border-strong)"
      />
      {renderPartShape(
        p.type,
        box,
        { x: box.x + w / 2, y: box.y + h / 2 },
        colorFor(p.type),
        false,
        1,
        1,
        chuteStateOf(p.partState),
      )}
      <text
        x={tile.x + TILE_W / 2}
        y={tile.y + TILE_H - 8}
        textAnchor="middle"
        fill="var(--color-text-primary)"
        fontSize={10}
      >
        {label.length > 18 ? `${label.slice(0, 16)}...` : label}
      </text>
      <title>{label}</title>
    </g>
  );
}
