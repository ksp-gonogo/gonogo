import { readingOf, type TopicReading } from "@ksp-gonogo/sitrep-client";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ExpandableText,
  Grid,
  Unit,
  type UnitValue,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import type { CelestialBody } from "./useCelestialBodies";

// Each readout restates its unit because `CelestialBody` carries bare magnitudes for the diagram's arithmetic.

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
  /** SOI event direction when this body is the vessel's upcoming encounter or escape destination; the caller matches `o.encounterBody` to the panel body first. */
  encounterDirection?: "encounter" | "escape" | null;
  /** Seconds until the SOI transition. Caller filters to positive values. */
  encounterTimeSec?: number | null;
  /** Next apsis on the *vessel's* orbit: 1 = Ap, -1 = Pe. Only shown when `isVesselParent`. */
  nextApsisType?: -1 | 1 | null;
  /** Seconds to the next apsis. */
  nextApsisTimeSec?: number | null;
  /**
   * The `vessel.orbit` read the vessel-derived rows were computed from, so each carries its currency.
   * The body rows take none: catalogue figures do not go stale when the craft stops reporting.
   */
  orbitCurrency?: TopicReading<unknown>;
}

interface AlmanacRow {
  label: string;
  value: ReactNode;
}

/** The atmosphere row's value, or `null` when the body does not say whether it has one. */
function atmosphereValue(body: CelestialBody): ReactNode | null {
  if (body.hasAtmosphere === false) return "None";
  if (body.hasAtmosphere !== true) return null;
  if (body.maxAtmosphere !== null) {
    return (
      <>
        <Unit value={value("m", body.maxAtmosphere)} />{" "}
        {body.hasOxygen === true ? "(O₂)" : "(no O₂)"}
      </>
    );
  }
  if (body.hasOxygen === true) return "Yes (O₂)";
  return "Yes";
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
  orbitCurrency: TopicReading<unknown> | undefined,
): AlmanacRow[] {
  // A figure computed from the orbit read, carrying that read's currency.
  const asOrbit = <U extends string>(magnitude: Value<U>): UnitValue<U> =>
    orbitCurrency === undefined
      ? magnitude
      : readingOf(orbitCurrency, () => magnitude);
  const rows: AlmanacRow[] = [];
  if (body.radius !== null) {
    rows.push({
      label: "Radius",
      value: <Unit value={value("m", body.radius)} />,
    });
  }
  if (body.mass !== null) {
    rows.push({
      label: "Mass",
      value: <Unit value={value("kg", body.mass)} />,
    });
  }
  if (body.geeASL !== null) {
    rows.push({
      label: "Surface gravity",
      value: <Unit value={value("g", body.geeASL)} />,
    });
  }
  if (body.rotationPeriod !== null) {
    rows.push({
      label: "Day length",
      value: <Unit value={value("s", Math.abs(body.rotationPeriod))} />,
    });
  }
  if (body.tidallyLocked === true) {
    rows.push({ label: "", value: "Tidally locked" });
  }
  if (body.soi !== null) {
    rows.push({
      label: "SOI",
      value: <Unit value={value("m", body.soi)} />,
    });
  }
  const atmosphere = atmosphereValue(body);
  if (atmosphere !== null)
    rows.push({ label: "Atmosphere", value: atmosphere });
  if (body.hasOcean === true) rows.push({ label: "", value: "Has ocean" });
  if (body.hillSphere !== null) {
    rows.push({
      label: "Hill sphere",
      value: <Unit value={value("m", body.hillSphere)} />,
    });
  }
  if (body.rotates === false) {
    rows.push({ label: "", value: "Does not rotate" });
  }
  if (body.period !== null) {
    rows.push({
      label: "Orbital period",
      value: <Unit value={value("s", body.period)} />,
    });
  }
  if (body.eccentricity !== null) {
    rows.push({
      label: "Eccentricity",
      value: <Unit value={value("1", body.eccentricity)} decimals={3} />,
    });
  }
  if (body.inclination !== null) {
    rows.push({
      label: "Inclination",
      value: <Unit value={value("°", body.inclination)} />,
    });
  }
  if (
    !isVesselParent &&
    phaseAngleDeg !== null &&
    phaseAngleDeg !== undefined
  ) {
    rows.push({
      label: "Phase angle",
      value: (
        <Unit value={asOrbit(value("°", normalizeAngle(phaseAngleDeg)))} />
      ),
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
      value: `${hohmannIdealDeg >= 0 ? "+" : ""}${writeQuantity(value("°", hohmannIdealDeg), { decimals: 1 })}`,
    });
    if (hohmannDeltaDeg !== null && hohmannDeltaDeg !== undefined) {
      const a = Math.abs(hohmannDeltaDeg);
      const tier = a < 2 ? "GO" : a < 10 ? "SOON" : "OFF";
      rows.push({
        label: "Δ from ideal",
        value: `${hohmannDeltaDeg >= 0 ? "+" : ""}${writeQuantity(value("°", hohmannDeltaDeg), { decimals: 1 })} · ${tier}`,
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
      value: <Unit value={asOrbit(value("s", encounterTimeSec))} />,
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
      value: <Unit value={asOrbit(value("s", nextApsisTimeSec))} />,
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
  orbitCurrency,
}: AlmanacPanelProps) {
  if (!body) {
    return (
      <Wrap>
        <div style={HINT}>
          Hover or focus a body in the diagram for almanac data, or pick the
          vessel's parent body to see its details.
        </div>
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
    orbitCurrency,
  );
  return (
    <Wrap>
      <div style={TITLE}>{body.name ?? "(unnamed)"}</div>
      {body.referenceBody && (
        <div style={SUB}>orbiting {body.referenceBody}</div>
      )}
      <div style={ROWS}>
        {rows.length === 0 ? (
          <div style={HINT}>Awaiting body data...</div>
        ) : (
          rows.map((row) => (
            <Grid
              cols="1fr auto"
              gap="label-value"
              align="baseline"
              key={`${row.label}=${row.value}`}
            >
              <span style={ROW_LABEL}>{row.label}</span>
              <span style={ROW_VALUE}>{row.value}</span>
            </Grid>
          ))
        )}
      </div>
      {body.description && !/^#autoLOC/i.test(body.description.trim()) && (
        <p style={DESCRIPTION}>
          <ExpandableText subject={body.name ?? undefined}>
            {body.description}
          </ExpandableText>
        </p>
      )}
    </Wrap>
  );
}

function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// The enclosing FramedDisplay's edge divides this panel from the diagram, so it draws no border.
const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  padding: "var(--inset-frame-panel)",
  minWidth: 0,
  // Grid items default to min-height:auto, which would grow past the sidebar cell instead of letting its scroller engage.
  minHeight: 0,
  maxWidth: "100%",
  background: "var(--color-surface-panel)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};

function Wrap({ children }: { children: ReactNode }) {
  // Panel.Sidebar supplies the scroller.
  return <aside style={WRAP}>{children}</aside>;
}

const TITLE: CSSProperties = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const SUB: CSSProperties = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.05em",
};

const ROWS: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  marginTop: "var(--gap-related-compact)",
};

const ROW_LABEL: CSSProperties = { color: "var(--color-text-faint)" };

const ROW_VALUE: CSSProperties = {
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const HINT: CSSProperties = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  lineHeight: "var(--line-height-body)",
};

const DESCRIPTION: CSSProperties = {
  margin: "var(--gap-related-comfortable) 0 0",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-compact)",
  lineHeight: "var(--line-height-body)",
  whiteSpace: "pre-wrap",
};
