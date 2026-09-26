import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import { readingOf } from "@ksp-gonogo/sitrep-client";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Unit, type UnitValue, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { normalizePhaseAngle } from "./transferWindow";
import type { CelestialBody } from "./useCelestialBodies";

// Each readout restates its unit because `CelestialBody` carries bare magnitudes for the diagram's arithmetic.

export interface AlmanacRow {
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

export function buildRows(
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
        <Unit value={asOrbit(value("°", normalizePhaseAngle(phaseAngleDeg)))} />
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
