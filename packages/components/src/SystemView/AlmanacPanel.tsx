import styled from "styled-components";
import type { CelestialBody } from "./useCelestialBodies";

export interface AlmanacPanelProps {
  /** Body to describe. When null, the panel renders an idle hint. */
  body: CelestialBody | null;
  /** Live phase angle to the active vessel, deg. Suppressed for the vessel's parent. */
  phaseAngleDeg?: number | null;
  /** Whether this body is the vessel's current parent — phase angle is meaningless. */
  isVesselParent?: boolean;
}

interface AlmanacRow {
  label: string;
  value: string;
}

function buildRows(
  body: CelestialBody,
  phaseAngleDeg: number | null,
  isVesselParent: boolean,
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
  return rows;
}

export function AlmanacPanel({
  body,
  phaseAngleDeg = null,
  isVesselParent = false,
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
  const rows = buildRows(body, phaseAngleDeg, isVesselParent);
  return (
    <Wrap>
      <Title>{body.name ?? "(unnamed)"}</Title>
      {body.referenceBody && <Sub>orbiting {body.referenceBody}</Sub>}
      <Rows>
        {rows.length === 0 ? (
          <Hint>Awaiting body data…</Hint>
        ) : (
          rows.map((row) => (
            <Row key={`${row.label}=${row.value}`}>
              <RowLabel>{row.label}</RowLabel>
              <RowValue>{row.value}</RowValue>
            </Row>
          ))
        )}
      </Rows>
    </Wrap>
  );
}

function formatLength(metres: number): string {
  const abs = Math.abs(metres);
  if (abs >= 1e9) return `${(metres / 1e9).toFixed(2)} Gm`;
  if (abs >= 1e6) return `${(metres / 1e6).toFixed(2)} Mm`;
  if (abs >= 1e3) return `${(metres / 1e3).toFixed(1)} km`;
  return `${metres.toFixed(0)} m`;
}

function formatMass(kg: number): string {
  const abs = Math.abs(kg);
  if (abs >= 1e24) return `${(kg / 1e24).toFixed(2)} Yg`;
  if (abs >= 1e21) return `${(kg / 1e21).toFixed(2)} Zg`;
  if (abs >= 1e18) return `${(kg / 1e18).toFixed(2)} Eg`;
  if (abs >= 1e15) return `${(kg / 1e15).toFixed(2)} Pg`;
  if (abs >= 1e12) return `${(kg / 1e12).toFixed(2)} Tg`;
  return `${kg.toFixed(0)} kg`;
}

function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  // KSP day = 6 h, year = 426 days. Use those rather than Earth equivalents.
  const HOUR = 3600;
  const DAY = 6 * HOUR;
  const YEAR = 426 * DAY;
  if (abs >= YEAR) return `${(seconds / YEAR).toFixed(2)} y`;
  if (abs >= DAY) return `${(seconds / DAY).toFixed(2)} d`;
  if (abs >= HOUR) return `${(seconds / HOUR).toFixed(2)} h`;
  if (abs >= 60) return `${(seconds / 60).toFixed(1)} min`;
  return `${seconds.toFixed(0)} s`;
}

function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

const Wrap = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  min-width: 0;
  max-width: 100%;
  background: var(--color-surface-panel);
  border-left: 1px solid var(--color-surface-raised);
  font-size: 11px;
  color: var(--color-text-muted);
  overflow-y: auto;
`;

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const Sub = styled.div`
  color: var(--color-text-faint);
  font-size: 10px;
  letter-spacing: 0.05em;
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 6px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
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
  font-size: 10px;
  line-height: 1.4;
`;
