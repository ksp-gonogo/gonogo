import { useMemo } from "react";
import styled from "styled-components";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Top-down view of every body orbiting a chosen parent. Each body is
 * drawn as a filled dot at an (x, y) derived from the current true
 * anomaly + semi-major axis + eccentricity + argument-of-periapsis-ish
 * placement (we use `lan` as a crude rotator so orbits don't all
 * overlap). The parent sits at the origin; its circle is the SoI
 * marker when known, the radius when not.
 *
 * The view isn't physically accurate — this is a schematic. Distances
 * use a log-ish scale within the chosen frame so the inner and outer
 * bodies are both visible.
 */

export interface SystemDiagramProps {
  bodies: readonly CelestialBody[];
  /** Name of the parent whose children we render. */
  parentName: string;
  /** Highlight these body names (current vessel body + target). */
  highlightNames?: readonly string[];
  /** Target body to highlight in a distinct colour. */
  targetName?: string | null;
  width: number;
  height: number;
}

const PAD = 16;

export function SystemDiagram({
  bodies,
  parentName,
  highlightNames,
  targetName,
  width,
  height,
}: SystemDiagramProps) {
  const { parent, children, maxRadius } = useMemo(
    () => organise(bodies, parentName),
    [bodies, parentName],
  );

  if (!parent || children.length === 0) {
    // Diagnostic: list distinct referenceBody values across the whole
    // body set so the user can see whether Telemachus is actually
    // emitting parent names that match `parentName`. A common cause
    // of the empty state is a name mismatch (e.g. "Sun" vs "Kerbol")
    // or referenceBody not arriving at all.
    const distinctParents = Array.from(
      new Set(
        bodies
          .map((b) => b.referenceBody)
          .filter((r): r is string => typeof r === "string" && r.length > 0),
      ),
    ).sort();
    const knownCount = bodies.filter((b) => b.name).length;
    return (
      <Empty>
        <div>
          No bodies orbiting <b>{parentName}</b> yet.
        </div>
        <Hint>
          Telemachus reports {knownCount} {knownCount === 1 ? "body" : "bodies"}
          {distinctParents.length > 0
            ? `; parents seen: ${distinctParents.join(", ")}`
            : "; no referenceBody values yet"}
          .
        </Hint>
      </Empty>
    );
  }

  const cx = width / 2;
  const cy = height / 2;
  const plotRadius = Math.min(width, height) / 2 - PAD;

  // Compute a non-linear scale — small semi-major axes compress on log,
  // large ones don't blow out. Add a tiny epsilon for the central body.
  const scale = (sma: number) =>
    Math.log10(1 + sma) / Math.log10(1 + maxRadius);

  const highlightSet = new Set(highlightNames ?? []);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`System view around ${parentName}`}
    >
      <title>
        System view around {parentName} ({children.length} bodies)
      </title>

      {/* Orbit circles */}
      {children.map((c) => {
        const sma = c.semiMajorAxis ?? 0;
        if (sma <= 0) return null;
        const r = scale(sma) * plotRadius;
        const ecc = c.eccentricity ?? 0;
        const ry = r * Math.sqrt(1 - Math.min(ecc * ecc, 0.999));
        const rot = c.lan ?? 0;
        return (
          <ellipse
            key={`orbit-${c.index}`}
            cx={cx}
            cy={cy}
            rx={r}
            ry={ry}
            fill="none"
            stroke="var(--color-status-info-bg)"
            strokeWidth={1}
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      })}

      {/* Parent body */}
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="var(--color-status-nogo-fg)"
        stroke="var(--color-status-warning-bg-muted)"
      />
      <text
        x={cx}
        y={cy + 18}
        fill="var(--color-status-nogo-fg)"
        fontSize={10}
        textAnchor="middle"
      >
        {parent.name}
      </text>

      {/* Child bodies */}
      {children.map((c) => {
        const sma = c.semiMajorAxis ?? 0;
        if (sma <= 0) return null;
        const r = scale(sma) * plotRadius;
        const theta = ((c.trueAnomaly ?? 0) * Math.PI) / 180;
        const lanRad = ((c.lan ?? 0) * Math.PI) / 180;
        // Crude ellipse placement — rotate around centre by lan, offset
        // on the major axis by (r * cos(theta)). Good enough for a
        // schematic; use real orbital math later if we need accuracy.
        const localX = r * Math.cos(theta);
        const localY =
          r *
          Math.sin(theta) *
          Math.sqrt(1 - Math.min((c.eccentricity ?? 0) ** 2, 0.999));
        const x = cx + localX * Math.cos(lanRad) - localY * Math.sin(lanRad);
        const y = cy + localX * Math.sin(lanRad) + localY * Math.cos(lanRad);
        const isTarget = targetName && c.name === targetName;
        const isHighlighted =
          !isTarget && c.name !== null && highlightSet.has(c.name);
        const dotR = isTarget ? 6 : isHighlighted ? 5 : 3;
        const fill = isTarget
          ? "var(--color-status-nogo-bg)"
          : isHighlighted
            ? "var(--color-accent-fg)"
            : "var(--color-status-info-fg)";
        return (
          <g key={`body-${c.index}`}>
            <circle
              cx={x}
              cy={y}
              r={dotR}
              fill={fill}
              stroke="var(--color-text-inverse)"
              strokeWidth={1}
            />
            <text x={x + dotR + 3} y={y + 3} fill={fill} fontSize={10}>
              {c.name ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function organise(
  bodies: readonly CelestialBody[],
  parentName: string,
): {
  parent: CelestialBody | null;
  children: CelestialBody[];
  maxRadius: number;
} {
  // Case + whitespace insensitive match — Telemachus has historically
  // shipped slightly different casings for body names across versions
  // ("Sun" vs "Sun ", and a stray "Kerbol" alias floating around).
  const target = parentName.trim().toLowerCase();
  const norm = (s: string | null) => (s ? s.trim().toLowerCase() : null);
  const parent = bodies.find((b) => norm(b.name) === target) ?? null;
  const children = bodies.filter((b) => norm(b.referenceBody) === target);
  let maxRadius = 0;
  for (const c of children) {
    if (c.semiMajorAxis && c.semiMajorAxis > maxRadius) {
      maxRadius = c.semiMajorAxis;
    }
  }
  return { parent, children, maxRadius };
}

const Empty = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 20px;
  text-align: center;
`;

const Hint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  max-width: 320px;
`;
