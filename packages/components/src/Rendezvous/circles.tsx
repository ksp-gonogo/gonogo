import { TargetIcon, VesselMarkSvg } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { CraftGeometry, Point2 } from "./geometry/craft";
import type { EncounterGeometry } from "./geometry/encounter";
import { lengthLabel } from "./scaleBar";

/** The side of the square every level's circle is drawn in, in its own units; the frame scales it to the measured diameter. */
export const DRAW = 596;
const C = DRAW / 2;
/** The radius the drawings reach to, which leaves a mark centred on it, the largest being 9 px across a half, clear of the frame's border. */
const rim = (unit: number) => C - 11 * unit;

const LINE = {
  chaser: "var(--color-accent-fg)",
  target: "var(--color-marker-target)",
  approach: "var(--color-warn-mark)",
  quiet: "var(--color-text-faint)",
  body: "var(--color-info-mark)",
  moon: "var(--color-text-faint)",
} as const;

/**
 * Sizes in screen pixels, which the drawings turn into drawn units with the
 * `unit` they are given (drawn units per pixel at the size the circle is shown
 * at), so a line, a mark and a label read the same in a small circle as in a
 * large one instead of shrinking with it.
 */
const PX = {
  line: 1.6,
  thin: 1.2,
  mark: 5,
  icon: 15,
  ring: 5,
  ringStroke: 2,
  dot: 3,
  text: 11,
  dash: [6, 4] as const,
};

/** One level's drawing and the length one metre takes on it, for the scale bar. */
export interface CircleView {
  svg: ReactNode;
  /** Drawn units per metre; null where the drawing has no single scale. */
  pxPerMetre: number | null;
}

function Drawing({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${DRAW} ${DRAW}`}
      role="img"
      aria-label={label}
      fontFamily="var(--font-family-mono)"
    >
      {children}
    </svg>
  );
}

const points = (ps: readonly (readonly [number, number])[]) =>
  ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** Far: both paths round the body at the scale that holds both, with the closest approach marked. */
export function farView(
  g: CraftGeometry,
  unit: number,
  small = false,
): CircleView {
  let reach = g.bodyRadius ?? 0;
  for (const p of [...g.plane.chaserOrbit, ...g.plane.targetOrbit]) {
    reach = Math.max(reach, Math.hypot(p[0], p[1]));
  }
  const k = reach > 0 ? rim(unit) / reach : 1;
  const at = (p: Point2): Point2 => [C + p[0] * k, C - p[1] * k];
  const bodyPx = Math.max((g.bodyRadius ?? 0) * k, 3 * unit);
  const chaser = at(g.plane.chaser);
  const target = at(g.plane.target);
  const approach = g.plane.targetAtApproach
    ? at(g.plane.targetAtApproach)
    : null;
  return {
    pxPerMetre: k,
    svg: (
      <Drawing label="Both paths round the body">
        <circle
          cx={C}
          cy={C}
          r={bodyPx}
          fill={LINE.body}
          fillOpacity={small ? 0.4 : 1}
        />
        {g.apart && (
          <polyline
            points={points(g.plane.targetOrbit.map(at))}
            fill="none"
            stroke={LINE.target}
            strokeWidth={PX.line * unit}
            strokeDasharray={`${7 * unit} ${5 * unit}`}
          />
        )}
        <polyline
          points={points(g.plane.chaserOrbit.map(at))}
          fill="none"
          stroke={LINE.chaser}
          strokeWidth={(g.apart ? PX.thin : PX.line + 0.8) * unit}
        />
        {approach && (
          <circle
            cx={approach[0]}
            cy={approach[1]}
            r={PX.ring * unit * 1.6}
            fill="none"
            stroke={LINE.approach}
            strokeWidth={PX.ringStroke * unit}
          />
        )}
        <TargetIcon
          x={target[0] - (PX.icon * unit) / 2}
          y={target[1] - (PX.icon * unit) / 2}
          size={PX.icon * unit}
        />
        <VesselMarkSvg x={chaser[0]} y={chaser[1]} r={PX.mark * unit} />
      </Drawing>
    ),
  };
}

/** Approach: you and the target at the scale that holds both and the closest approach, the target held still. */
export function approachView(
  g: CraftGeometry,
  unit: number,
  small = false,
): CircleView {
  // Screen: x is minus the along-track offset (travel to the left), up is radial out.
  const s = (p: readonly [number, number, number]): Point2 => [-p[1], p[0]];
  const me = s(g.relative);
  const miss = g.approachRelative ? s(g.approachRelative) : null;
  const mid: Point2 = [me[0] / 2, me[1] / 2];
  const reach = Math.max(
    Math.hypot(me[0], me[1]) / 2,
    miss ? Math.hypot(miss[0] - mid[0], miss[1] - mid[1]) : 0,
    20,
  );
  const half = reach * 1.12;
  const k = rim(unit) / half;
  const at = (p: Point2): Point2 => [
    C + (p[0] - mid[0]) * k,
    C - (p[1] - mid[1]) * k,
  ];
  // The two local orbit lines: arcs about the body's centre, which sits straight below the target.
  const arc = (radius: number): Point2[] => {
    const out: Point2[] = [];
    for (let i = -20; i <= 20; i++) {
      const x = (half * 2 * i) / 20 + mid[0];
      const dy =
        Math.sqrt(Math.max(radius * radius - x * x, 0)) - g.targetRadius;
      out.push(at([x, dy]));
    }
    return out;
  };
  const chaserRadius = Math.hypot(
    g.targetRadius + g.relative[0],
    g.relative[1],
  );
  const track = g.track ? g.track.map((p) => at(s(p))) : [];
  const origin = at([0, 0]);
  const meAt = at(me);
  const missAt = miss ? at(miss) : null;
  return {
    pxPerMetre: k,
    svg: (
      <Drawing label="You and the target">
        <polyline
          points={points(arc(g.targetRadius))}
          fill="none"
          stroke={LINE.target}
          strokeWidth={PX.line * unit}
          strokeDasharray={`${7 * unit} ${5 * unit}`}
        />
        <polyline
          points={points(arc(chaserRadius))}
          fill="none"
          stroke={LINE.chaser}
          strokeWidth={PX.thin * unit}
          opacity={0.8}
        />
        {track.length > 1 && (
          <polyline
            points={points(track)}
            fill="none"
            stroke={LINE.chaser}
            strokeWidth={(PX.line + 0.6) * unit}
            strokeDasharray={`${PX.dash[0] * unit} ${PX.dash[1] * unit}`}
          />
        )}
        {missAt && (
          <>
            <line
              x1={missAt[0]}
              y1={missAt[1]}
              x2={origin[0]}
              y2={origin[1]}
              stroke={LINE.approach}
              strokeWidth={PX.ringStroke * unit}
            />
            <circle
              cx={missAt[0]}
              cy={missAt[1]}
              r={PX.ring * unit}
              fill="none"
              stroke={LINE.approach}
              strokeWidth={PX.ringStroke * unit}
            />
            {g.approach && !small && (
              <text
                x={(missAt[0] + origin[0]) / 2}
                y={
                  Math.min(missAt[1], origin[1]) -
                  (PX.ring + PX.ringStroke + 3) * unit
                }
                textAnchor="middle"
                fill={LINE.approach}
                fontSize={PX.text * unit}
                fontWeight={600}
              >
                {lengthLabel(Math.round(g.approach.distance * 10) / 10 || 0.1)}
              </text>
            )}
          </>
        )}
        <TargetIcon
          x={origin[0] - (PX.icon * unit) / 2}
          y={origin[1] - (PX.icon * unit) / 2}
          size={PX.icon * unit}
        />
        <VesselMarkSvg x={meAt[0]} y={meAt[1]} r={PX.mark * unit} />
      </Drawing>
    ),
  };
}

/**
 * Where a caption goes beside a ring: the first of eight places round it
 * (right, left, below and above, each way) whose box holds none of the
 * `obstacles`, or none where every place is crossed. Text is drawn from its baseline,
 * so the box runs from `size` above `y` to a quarter of `size` below it.
 */
function placeLabel(
  ring: Point2,
  ringR: number,
  width: number,
  size: number,
  obstacles: readonly Point2[],
  order: "below-first" | "above-first",
): { x: number; y: number; anchor: "start" | "end" } | null {
  const gap = 3;
  const below = ring[1] + ringR + gap + size;
  const above = ring[1] - ringR - gap - size * 0.25;
  const rows = order === "below-first" ? [below, above] : [above, below];
  const candidates: { x: number; y: number; anchor: "start" | "end" }[] = [];
  for (const y of rows) {
    candidates.push({ x: ring[0] + ringR * 0.5, y, anchor: "start" });
    candidates.push({ x: ring[0] - ringR * 0.5, y, anchor: "end" });
  }
  for (const y of [ring[1] + size * 0.35]) {
    candidates.push({ x: ring[0] + ringR + gap, y, anchor: "start" });
    candidates.push({ x: ring[0] - ringR - gap, y, anchor: "end" });
  }
  let best = candidates[0];
  let fewest = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const left = c.anchor === "start" ? c.x : c.x - width;
    const hits = obstacles.filter(
      ([x, y]) =>
        x > left && x < left + width && y > c.y - size && y < c.y + size * 0.25,
    ).length;
    if (hits < fewest) {
      fewest = hits;
      best = c;
    }
    if (hits === 0) break;
  }
  return fewest === 0 ? best : null;
}

/** Encounter: the body at its own scale, the path through its sphere of influence, periapsis, and the entry and exit. */
export function encounterView(
  g: EncounterGeometry,
  bodyIsMoon: boolean,
  unit: number,
): CircleView {
  const k = rim(unit) / (g.soi * 1.15);
  const at = (p: Point2): Point2 => [C + p[0] * k, C - p[1] * k];
  const bodyPx = Math.max(g.bodyRadius * k, 4 * unit);
  const pe = at(g.periapsis.point);
  const entry = g.entry ? at(g.entry) : null;
  const exit = g.exit ? at(g.exit) : null;
  const craft = g.craft ? at(g.craft) : null;
  const peLabel = lengthLabel(Math.round(g.periapsis.altitude));
  const fontSize = PX.text * unit;
  const path = g.path.map(at);
  // Everything the label must stay clear of: the path, the sphere's edge, the body, the dots and the craft.
  const obstacles: Point2[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let j = 0; j <= n; j++) {
      obstacles.push([
        a[0] + ((b[0] - a[0]) * j) / n,
        a[1] + ((b[1] - a[1]) * j) / n,
      ]);
    }
  }
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    obstacles.push([C + g.soi * k * Math.cos(t), C + g.soi * k * Math.sin(t)]);
    for (let r = 0; r <= bodyPx; r += Math.max(2, bodyPx / 4)) {
      obstacles.push([C + r * Math.cos(t), C + r * Math.sin(t)]);
    }
  }
  for (const [m, radius] of [
    [entry, PX.dot * unit],
    [exit, PX.dot * unit],
    [craft, PX.mark * unit],
  ] as const) {
    if (!m) continue;
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      obstacles.push([
        m[0] + radius * Math.cos(t),
        m[1] + radius * Math.sin(t),
      ]);
    }
    obstacles.push(m);
  }
  const label = placeLabel(
    pe,
    PX.ring * unit,
    peLabel.length * fontSize * 0.62,
    fontSize,
    obstacles,
    // Below the ring first, then above, since the scale bar runs along the circle's foot.
    pe[1] > C ? "above-first" : "below-first",
  );
  return {
    pxPerMetre: k,
    svg: (
      <Drawing label="The body and your path through its sphere of influence">
        <circle
          cx={C}
          cy={C}
          r={g.soi * k}
          fill="none"
          stroke={LINE.quiet}
          strokeDasharray={`${2 * unit} ${4 * unit}`}
          strokeWidth={PX.thin * unit}
        />
        <circle
          cx={C}
          cy={C}
          r={bodyPx}
          fill={bodyIsMoon ? LINE.moon : LINE.body}
        />
        <polyline
          points={points(g.path.map(at))}
          fill="none"
          stroke={LINE.chaser}
          strokeWidth={(PX.line + 0.6) * unit}
          strokeDasharray={`${PX.dash[0] * unit} ${PX.dash[1] * unit}`}
        />
        {entry && (
          <circle
            cx={entry[0]}
            cy={entry[1]}
            r={PX.dot * unit}
            fill={LINE.chaser}
          />
        )}
        {exit && (
          <circle
            cx={exit[0]}
            cy={exit[1]}
            r={PX.dot * unit}
            fill={LINE.chaser}
          />
        )}
        <circle
          cx={pe[0]}
          cy={pe[1]}
          r={PX.ring * unit}
          fill="none"
          stroke={LINE.approach}
          strokeWidth={PX.ringStroke * unit}
        />
        {label && (
          <text
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            fill={LINE.approach}
            fontSize={PX.text * unit}
            fontWeight={600}
          >
            {peLabel}
          </text>
        )}
        {craft && (
          <VesselMarkSvg x={craft[0]} y={craft[1]} r={PX.mark * unit} />
        )}
      </Drawing>
    ),
  };
}
