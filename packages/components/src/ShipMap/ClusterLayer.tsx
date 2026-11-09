import { CloseIcon, Floating, IconButton } from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DenseCluster } from "./denseCluster";
import { chuteStateOf } from "./partChute";
import { colorFor, renderPartShape } from "./partShape";
import { PartGroup } from "./ShipPartGroup";
import type { ProjectedPart } from "./shipLayout";

const ICON_RADIUS = 10;
const TILE_W = 112;
const TILE_H = 92;
const TILE_GAP = 6;
const BOX_PAD = 8;
const TITLE_H = 24;
/** The widest share of the view the box may take, so the craft stays in sight beside it. */
const BOX_MAX_SHARE = 0.6;
const MIN_SCALE = 0.4;

interface BoxLayout {
  columns: number;
  rows: number;
  /** Shrinks every box dimension, 1 at full size. */
  scale: number;
  boxW: number;
  boxH: number;
}

/**
 * The column count and scale that lay `count` tiles out in the largest size the
 * view holds: more columns when the view is wide and short, fewer when narrow.
 */
export function boxLayoutFor(
  count: number,
  width: number,
  height: number,
): BoxLayout {
  let best: BoxLayout | null = null;
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns);
    const fullW = columns * TILE_W + (columns - 1) * TILE_GAP + BOX_PAD * 2;
    const fullH = TITLE_H + rows * TILE_H + (rows - 1) * TILE_GAP + BOX_PAD * 2;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, (width * BOX_MAX_SHARE - 12) / fullW, (height - 12) / fullH),
    );
    if (!best || scale > best.scale + 1e-6) {
      best = { columns, rows, scale, boxW: fullW * scale, boxH: fullH * scale };
    }
  }
  return best as BoxLayout;
}

interface Point {
  x: number;
  y: number;
}

/** How long the popover outlives the pointer leaving its icon, so the pointer can cross the gap to it. */
const HOVER_LINGER_MS = 150;

/** The gap between an icon and the popover beside it. */
const ICON_GAP = 8;

/** The room the popover's layout is sized for at most, independent of the widget it opens from. */
const POPOVER_ROOM = { w: 640, h: 360 };

/** Floating's distance from the viewport edge, which the popover must leave on both sides. */
const VIEWPORT_EDGE = 8;

/** How long after a touch tap its click may still arrive and be taken as the same tap. */
const TAP_CLICK_BACKSTOP_MS = 3000;

/** The radius of the invisible disc around an icon that takes a press, so a finger lands on it. */
const HIT_RADIUS = 20;

/**
 * The room the popover is laid out in: the fixed room, or the viewport less its
 * edges where that is smaller, so the box fits a phone.
 */
function popoverRoom(viewport: { w: number; h: number }) {
  const maxBoxW = Math.min(
    POPOVER_ROOM.w * BOX_MAX_SHARE,
    viewport.w - 2 * VIEWPORT_EDGE,
  );
  return {
    w: (maxBoxW + 12) / BOX_MAX_SHARE,
    h: Math.min(POPOVER_ROOM.h, viewport.h - 2 * VIEWPORT_EDGE + 12),
  };
}

const readViewport = () => ({ w: window.innerWidth, h: window.innerHeight });

function useViewport() {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

/**
 * The expand icons beside each dense cluster of radial parts and a popover
 * laying every part of the cluster out at its own proportions. Hovering or
 * focusing an icon shows the popover (a finger touching down does not); pressing the icon pins it open until the
 * icon is pressed again, a press lands outside both, or Escape is pressed; a
 * tap on a touch screen pins it the same way. The popover is drawn over the
 * page beside the icon, so the widget's edge does not clip it, and is sized to
 * stay inside the viewport. The icons are
 * drawn in screen space so they stay one size however far the view is zoomed.
 * Used by the Ship Map for rings of parts too crowded to tell apart in place.
 */
export function ClusterLayer({
  clusters,
  toScreen,
  width,
  openId,
  onToggle,
}: {
  clusters: readonly DenseCluster[];
  /** A metre-space lateral and axial position as a point in the SVG's own pixels. */
  toScreen: (lat: number, axial: number) => Point;
  width: number;
  /** The cluster pinned open, which stays until it is toggled off or Escape is pressed. */
  openId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const iconRefs = useRef(new Map<string, SVGGElement>());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdHover = (id: string) => {
    if (lingerRef.current) clearTimeout(lingerRef.current);
    lingerRef.current = null;
    setHoverId(id);
  };
  const releaseHover = () => {
    if (lingerRef.current) clearTimeout(lingerRef.current);
    lingerRef.current = setTimeout(() => setHoverId(null), HOVER_LINGER_MS);
  };
  useEffect(
    () => () => {
      if (lingerRef.current) clearTimeout(lingerRef.current);
    },
    [],
  );
  /* Returning focus to the icon after a close must not read as focusing it to look, which would open the popover again. */
  const quietFocusRef = useRef(false);
  const focusIcon = useCallback((id: string) => {
    quietFocusRef.current = true;
    iconRefs.current.get(id)?.focus();
    quietFocusRef.current = false;
  }, []);
  /*
   * A finger's tap toggles on pointer-up; the click that follows it must not
   * toggle again. The flag lasts until that click or the next pointer-down, so a
   * slow click is still matched to its own tap. The backstop only frees a flag
   * whose click never came, so a later click with no pointer-down (a screen
   * reader activating the icon) is not swallowed.
   */
  const tappedRef = useRef(false);
  const tapBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setTapped = (tapped: boolean) => {
    tappedRef.current = tapped;
    if (tapBackstopRef.current) clearTimeout(tapBackstopRef.current);
    tapBackstopRef.current = tapped
      ? setTimeout(() => {
          tappedRef.current = false;
        }, TAP_CLICK_BACKSTOP_MS)
      : null;
  };
  useEffect(
    () => () => {
      if (tapBackstopRef.current) clearTimeout(tapBackstopRef.current);
    },
    [],
  );
  const shownId = openId ?? hoverId;
  const shown = clusters.find((c) => c.id === shownId);
  useEffect(() => {
    if (!shown) return;
    /* Captured and stopped only while pinned open, so an enclosing dialog does not also close on the Escape that closes the popover; a popover shown on hover alone leaves Escape to the dialog. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHoverId(null);
      if (openId !== null) {
        e.stopPropagation();
        onToggle(null);
        focusIcon(openId);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [shown, openId, onToggle, focusIcon]);

  useEffect(() => {
    if (openId === null) return;
    const away = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest("[data-role='cluster-expand'], [data-cluster-popover]")
      )
        return;
      onToggle(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [openId, onToggle]);
  return (
    <g data-role="cluster-layer">
      {shown && (
        <ClusterPopover
          cluster={shown}
          pinned={shown.id === openId}
          iconRect={() =>
            iconRefs.current.get(shown.id)?.getBoundingClientRect()
          }
          onEnter={() => holdHover(shown.id)}
          onLeave={releaseHover}
          onClose={() => {
            onToggle(null);
            focusIcon(shown.id);
          }}
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
            onClick={() => {
              if (tappedRef.current) {
                setTapped(false);
                return;
              }
              activate();
            }}
            onPointerDown={() => setTapped(false)}
            onPointerCancel={() => setTapped(false)}
            onPointerUp={(e: React.PointerEvent) => {
              if (e.pointerType !== "touch") return;
              setTapped(true);
              activate();
            }}
            onPointerEnter={(e: React.PointerEvent) => {
              if (e.pointerType !== "touch") holdHover(c.id);
            }}
            onPointerLeave={releaseHover}
            onFocus={() => {
              if (!quietFocusRef.current) holdHover(c.id);
            }}
            onBlur={releaseHover}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              activate();
            }}
          >
            <circle cx={cx} cy={cy} r={HIT_RADIUS} fill="transparent" />
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

function ClusterPopover({
  cluster,
  pinned,
  iconRect,
  onEnter,
  onLeave,
  onClose,
}: {
  cluster: DenseCluster;
  pinned: boolean;
  /** Where the cluster's icon is on screen, so the popover sits beside it rather than over it. */
  iconRect: () => DOMRect | undefined;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const viewport = useViewport();
  const members = [...cluster.members].sort(
    (a, b) => a.lat - b.lat || b.axial - a.axial,
  );
  const room = popoverRoom(viewport);
  const {
    columns,
    scale: k,
    boxW,
    boxH,
  } = boxLayoutFor(members.length, room.w, room.h);
  const tileW = TILE_W * k;
  const tileH = TILE_H * k;
  const gap = TILE_GAP * k;
  const pad = BOX_PAD * k;
  const titleH = TITLE_H * k;
  return (
    <Floating
      anchor={() => {
        const rect = iconRect();
        if (!rect) return null;
        /* The layer goes after its anchor when it fits and before it otherwise, so the anchor is the icon's edge on whichever side has the room. */
        const roomRight = window.innerWidth - (rect.right + ICON_GAP);
        return {
          x: roomRight >= boxW ? rect.right + ICON_GAP : rect.left - ICON_GAP,
          y: rect.top,
        };
      }}
      role="group"
      data-cluster-popover=""
      aria-label={`The ${members.length} clustered parts, laid out`}
      style={{ pointerEvents: "auto" }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <svg
        data-role="cluster-box"
        width={boxW}
        height={boxH}
        style={{ display: "block" }}
      >
        <title>{`The ${members.length} clustered parts, laid out`}</title>
        <rect
          x={0.5}
          y={0.5}
          width={boxW - 1}
          height={boxH - 1}
          rx={6}
          fill="var(--color-surface-sunken)"
          stroke="var(--color-border-strong)"
        />
        <text
          x={pad}
          y={17 * k}
          fill="var(--color-text-primary)"
          fontSize={Math.max(8, 11 * k)}
        >
          {`${members.length} parts`}
        </text>
        {members.map((p, i) => (
          <MemberTile
            key={p.flightId}
            part={p}
            tile={{
              x: pad + (i % columns) * (tileW + gap),
              y: titleH + pad + Math.floor(i / columns) * (tileH + gap),
            }}
            scale={k}
          />
        ))}
      </svg>
      {pinned && (
        <IconButton
          aria-label="Close the expanded parts"
          onClick={onClose}
          style={{ position: "absolute", top: 4 * k, right: 6 * k }}
        >
          <CloseIcon />
        </IconButton>
      )}
    </Floating>
  );
}

function MemberTile({
  part: p,
  tile,
  scale: k,
}: {
  part: ProjectedPart;
  tile: Point;
  scale: number;
}) {
  const pw = Math.max(p.body.latMax - p.body.latMin, 1e-3);
  const ph = Math.max(p.body.axialMax - p.body.axialMin, 1e-3);
  const tileW = TILE_W * k;
  const tileH = TILE_H * k;
  const fit = Math.min((tileW - 24 * k) / pw, (tileH - 34 * k) / ph);
  const w = pw * fit;
  const h = ph * fit;
  const box = { x: tile.x + (tileW - w) / 2, y: tile.y + 8 * k, w, h };
  const label = p.title || p.name;
  return (
    <g data-role="cluster-member" data-part-id={p.flightId}>
      <rect
        x={tile.x}
        y={tile.y}
        width={tileW}
        height={tileH}
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
        x={tile.x + tileW / 2}
        y={tile.y + tileH - 8 * k}
        textAnchor="middle"
        fill="var(--color-text-primary)"
        fontSize={Math.max(7, 10 * k)}
      >
        {label.length > 18 ? `${label.slice(0, 16)}...` : label}
      </text>
      <title>{label}</title>
    </g>
  );
}
