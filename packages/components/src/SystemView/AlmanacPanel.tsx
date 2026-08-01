import { formatDuration, formatQuantity } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
import type { CelestialBody } from "./useCelestialBodies";

export interface AlmanacPanelProps {
  /** Body to describe. When null, the panel renders an idle hint. */
  body: CelestialBody | null;
  /** Live phase angle to the active vessel, deg. Suppressed for the vessel's parent. */
  phaseAngleDeg?: number | null;
  /** Whether this body is the vessel's current parent, phase angle is meaningless. */
  isVesselParent?: boolean;
  /** Hohmann ideal departure phase angle (deg), if the vessel and body share a parent. */
  hohmannIdealDeg?: number | null;
  /** Signed delta from ideal (deg). Negative = early; positive = late. */
  hohmannDeltaDeg?: number | null;
  /**
   * SOI event direction when *this* body is the vessel's upcoming encounter
   * (or escape destination). `null` means no relevant transition for this
   * body. Caller is responsible for matching `o.encounterBody` to the panel
   * body before passing this through.
   */
  encounterDirection?: "encounter" | "escape" | null;
  /** Seconds until the SOI transition. Caller filters to positive values. */
  encounterTimeSec?: number | null;
  /** Next apsis on the *vessel's* orbit: 1 = Ap, -1 = Pe. Only shown when `isVesselParent`. */
  nextApsisType?: -1 | 1 | null;
  /** Seconds to the next apsis. */
  nextApsisTimeSec?: number | null;
}

interface AlmanacRow {
  label: string;
  value: string;
}

function buildRows(
  body: CelestialBody,
  phaseAngleDeg: number | null,
  isVesselParent: boolean,
  hohmannIdealDeg: number | null,
  hohmannDeltaDeg: number | null,
  encounterDirection: "encounter" | "escape" | null,
  encounterTimeSec: number | null,
  nextApsisType: -1 | 1 | null,
  nextApsisTimeSec: number | null,
): AlmanacRow[] {
  const rows: AlmanacRow[] = [];
  if (body.radius !== null) {
    rows.push({ label: "Radius", value: formatLength(body.radius) });
  }
  if (body.mass !== null) {
    rows.push({ label: "Mass", value: formatMass(body.mass) });
  }
  if (body.geeASL !== null) {
    rows.push({
      label: "Surface gravity",
      value: `${body.geeASL.toFixed(2)} g`,
    });
  }
  if (body.rotationPeriod !== null) {
    rows.push({
      label: "Day length",
      value: formatDuration(Math.abs(body.rotationPeriod)),
    });
  }
  if (body.tidallyLocked === true) {
    rows.push({ label: "", value: "Tidally locked" });
  }
  if (body.soi !== null) {
    rows.push({ label: "SOI", value: formatLength(body.soi) });
  }
  if (body.hasAtmosphere === true) {
    rows.push({
      label: "Atmosphere",
      value:
        body.maxAtmosphere !== null
          ? `${formatLength(body.maxAtmosphere)} ${
              body.hasOxygen === true ? "(O₂)" : "(no O₂)"
            }`
          : body.hasOxygen === true
            ? "Yes (O₂)"
            : "Yes",
    });
  } else if (body.hasAtmosphere === false) {
    rows.push({ label: "Atmosphere", value: "None" });
  }
  if (body.hasOcean === true) rows.push({ label: "", value: "Has ocean" });
  if (body.hillSphere !== null) {
    rows.push({ label: "Hill sphere", value: formatLength(body.hillSphere) });
  }
  if (body.rotates === false) {
    rows.push({ label: "", value: "Does not rotate" });
  }
  if (body.period !== null) {
    rows.push({ label: "Orbital period", value: formatDuration(body.period) });
  }
  if (body.eccentricity !== null) {
    rows.push({ label: "Eccentricity", value: body.eccentricity.toFixed(3) });
  }
  if (body.inclination !== null) {
    rows.push({
      label: "Inclination",
      value: `${body.inclination.toFixed(2)}°`,
    });
  }
  if (
    !isVesselParent &&
    phaseAngleDeg !== null &&
    phaseAngleDeg !== undefined
  ) {
    rows.push({
      label: "Phase angle",
      value: `${normalizeAngle(phaseAngleDeg).toFixed(1)}°`,
    });
  }
  if (
    !isVesselParent &&
    hohmannIdealDeg !== null &&
    hohmannIdealDeg !== undefined &&
    Number.isFinite(hohmannIdealDeg)
  ) {
    rows.push({
      label: "Hohmann ideal",
      value: `${hohmannIdealDeg >= 0 ? "+" : ""}${hohmannIdealDeg.toFixed(1)}°`,
    });
    if (hohmannDeltaDeg !== null && hohmannDeltaDeg !== undefined) {
      const a = Math.abs(hohmannDeltaDeg);
      const tier = a < 2 ? "GO" : a < 10 ? "SOON" : "OFF";
      rows.push({
        label: "Δ from ideal",
        value: `${hohmannDeltaDeg >= 0 ? "+" : ""}${hohmannDeltaDeg.toFixed(1)}° · ${tier}`,
      });
    }
  }
  if (
    encounterDirection !== null &&
    encounterTimeSec !== null &&
    Number.isFinite(encounterTimeSec) &&
    encounterTimeSec > 0
  ) {
    rows.push({
      label: encounterDirection === "escape" ? "Escape in" : "Encounter in",
      value: formatDuration(encounterTimeSec),
    });
  }
  if (
    isVesselParent &&
    nextApsisType !== null &&
    nextApsisTimeSec !== null &&
    Number.isFinite(nextApsisTimeSec) &&
    nextApsisTimeSec >= 0
  ) {
    rows.push({
      label: nextApsisType === -1 ? "Next Pe" : "Next Ap",
      value: formatDuration(nextApsisTimeSec),
    });
  }
  return rows;
}

export function AlmanacPanel({
  body,
  phaseAngleDeg = null,
  isVesselParent = false,
  hohmannIdealDeg = null,
  hohmannDeltaDeg = null,
  encounterDirection = null,
  encounterTimeSec = null,
  nextApsisType = null,
  nextApsisTimeSec = null,
}: AlmanacPanelProps) {
  if (!body) {
    return (
      <Wrap>
        <Hint>
          Hover or focus a body in the diagram for almanac data, or pick the
          vessel's parent body to see its details.
        </Hint>
      </Wrap>
    );
  }
  const rows = buildRows(
    body,
    phaseAngleDeg,
    isVesselParent,
    hohmannIdealDeg,
    hohmannDeltaDeg,
    encounterDirection,
    encounterTimeSec,
    nextApsisType,
    nextApsisTimeSec,
  );
  return (
    <Wrap>
      <Title>{body.name ?? "(unnamed)"}</Title>
      {body.referenceBody && <Sub>orbiting {body.referenceBody}</Sub>}
      <Rows>
        {rows.length === 0 ? (
          <Hint>Awaiting body data...</Hint>
        ) : (
          rows.map((row) => (
            <AlmanacLine key={`${row.label}=${row.value}`}>
              <RowLabel>{row.label}</RowLabel>
              <RowValue>{row.value}</RowValue>
            </AlmanacLine>
          ))
        )}
      </Rows>
      {body.description && !/^#autoLOC/i.test(body.description.trim()) && (
        <Description>{body.description}</Description>
      )}
    </Wrap>
  );
}

// Both of these are now one-line adapters onto the shared ladders. They stay
// as named functions only because the call sites read better for it; the
// scaling, the thresholds and the precision all come from ui-kit.
function formatLength(metres: number): string {
  const { value, symbol } = formatQuantity(metres, "m");
  return `${value} ${symbol}`;
}

function formatMass(kg: number): string {
  const { value, symbol } = formatQuantity(kg, "kg");
  return `${value} ${symbol}`;
}

function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/* No divider rule of its own. It used to carry a border on whichever edge
   faced the diagram, which meant the panel had to be told where it was docked;
   the diagram now sits in a FramedDisplay, and that frame's edge does the
   dividing on every side at once. */
const WrapOuter = styled.aside`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) var(--space-10);
  min-width: 0;
  /* min-height:0 is load-bearing: the panel sidebar this sits in is a grid
     cell, and grid items default to min-height:auto, which would let this box
     grow past the cell and get hard-clipped by the parent's overflow:hidden
     instead of letting the sidebar's own scroller engage. */
  min-height: 0;
  max-width: 100%;
  background: var(--color-surface-panel);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

function Wrap({ children }: { children: ReactNode }) {
  /* No ScrollArea of its own. `Panel.Sidebar` supplies one, and a second inside
     it scrolled nothing: the outer one took the overflow and this one sized to
     its content, so it was inert chrome plus a duplicate glow. The layout it
     carried (column + gap) moves onto the box that is left. */
  return <WrapOuter>{children}</WrapOuter>;
}

const Title = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const Sub = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.05em;
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  margin-top: var(--space-6);
`;

const AlmanacLine = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-8);
  align-items: baseline;
`;

const RowLabel = styled.span`
  color: var(--color-text-faint);
`;

const RowValue = styled.span`
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const Hint = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-2xs);
  line-height: var(--line-height-body);
`;

/** KSP's per-body flavour text. Long-form copy lives below the stats grid;
 *  the panel scroll handles overflow on shorter widget sizes. */
const Description = styled.p`
  margin: var(--space-8) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-2xs);
  line-height: var(--line-height-body);
  white-space: pre-wrap;
`;
