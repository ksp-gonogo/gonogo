import { getBody } from "@gonogo/core";
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

  // Linear scale. Earlier we used log10(1+sma)/log10(1+maxRadius) but the
  // log compression made every Kerbol orbit (Moho 5.3e9 → Eeloo 9e10, ~17×
  // ratio) plot on roughly the same circle. Linear gives a faithful
  // spatial picture for KSP's body distribution; if we ever need to
  // accommodate a 100× outer-system mod, switch to a power scale at that
  // point rather than re-introducing log.
  const scale = (sma: number) => sma / maxRadius;

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

      {/* Orbit circles — bumped opacity / stroke so they read against
          the dark background. Each orbit is rotated by lan to spread
          eccentric ellipses around their actual line of nodes. */}
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
            stroke="var(--color-text-faint)"
            strokeWidth={0.8}
            opacity={0.55}
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      })}

      {/* Parent body */}
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={parentColor(parent)}
        stroke="var(--color-text-inverse)"
        strokeWidth={1}
      />
      <text
        x={cx}
        y={cy + 18}
        fill="var(--color-text-primary)"
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
        const dotR = isTarget ? 6 : isHighlighted ? 5 : 3.5;
        // Body fill: target/highlight overrides win for navigation
        // affordance; otherwise pull the canonical body colour from
        // the stock registry so each body reads as itself.
        const stockColor = c.name ? getBody(c.name)?.color : undefined;
        const fill = isTarget
          ? "var(--color-status-nogo-bg)"
          : isHighlighted
            ? "var(--color-accent-fg)"
            : (stockColor ?? "var(--color-status-info-fg)");
        const labelFill = isTarget
          ? "var(--color-status-nogo-bg)"
          : isHighlighted
            ? "var(--color-accent-fg)"
            : "var(--color-text-primary)";
        return (
          <g key={`body-${c.index}`}>
            <circle
              cx={x}
              cy={y}
              r={dotR}
              fill={fill}
              stroke="var(--color-text-inverse)"
              strokeWidth={1}
            >
              <title>{bodyTooltip(c)}</title>
            </circle>
            <text x={x + dotR + 3} y={y + 3} fill={labelFill} fontSize={10}>
              {c.name ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function parentColor(parent: CelestialBody): string {
  return (
    (parent.name ? getBody(parent.name)?.color : undefined) ??
    "var(--color-status-warning-bg)"
  );
}

function bodyTooltip(c: CelestialBody): string {
  const lines: string[] = [c.name ?? "(unnamed)"];
  if (c.radius) lines.push(`Radius: ${formatKm(c.radius)} km`);
  if (c.semiMajorAxis) lines.push(`SMA: ${formatGm(c.semiMajorAxis)} Gm`);
  if (c.eccentricity !== null && c.eccentricity !== undefined) {
    lines.push(`Ecc: ${c.eccentricity.toFixed(3)}`);
  }
  if (c.inclination !== null && c.inclination !== undefined) {
    lines.push(`Inc: ${c.inclination.toFixed(1)}°`);
  }
  if (c.period) lines.push(`Period: ${formatHours(c.period)} h`);
  if (c.hasAtmosphere) lines.push("Atmosphere");
  return lines.join("\n");
}

function formatKm(m: number): string {
  return (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatGm(m: number): string {
  return (m / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatHours(s: number): string {
  return (s / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 });
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
