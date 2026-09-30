import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ReckonedUnit,
  Unit,
  type UnitValue,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { CatalogueHeld, CelestialBody } from "./useCelestialBodies";

// Each readout restates its unit because `CelestialBody` carries bare magnitudes for the diagram's arithmetic.

export interface AlmanacRow {
  label: string;
  value: ReactNode;
}

/**
 * A catalogue figure as the reading it arrived in, so one drawn while the
 * catalogue has stopped arriving is marked held. A static figure is left
 * unmarked by the kit whatever the reading says.
 */
function asOf<Unit extends string>(
  figure: Value<Unit>,
  held: CatalogueHeld | null,
): UnitValue<Unit> {
  if (held === null) return figure;
  return {
    state: "held",
    value: figure,
    asOfUt: held.asOfUt,
    grade: held.grade,
    reckoning: { status: "none" },
  };
}

/** The atmosphere row's value, or `null` when the body does not say whether it has one. */
function atmosphereValue(
  body: CelestialBody,
  held: CatalogueHeld | null,
): ReactNode | null {
  if (body.hasAtmosphere === false) return "None";
  if (body.hasAtmosphere !== true) return null;
  if (body.figures.atmosphereDepth !== null) {
    return (
      <>
        <Unit value={asOf(body.figures.atmosphereDepth, held)} />{" "}
        {body.hasOxygen === true ? "(O₂)" : "(no O₂)"}
      </>
    );
  }
  if (body.hasOxygen === true) return "Yes (O₂)";
  return "Yes";
}

export function buildRows(
  body: CelestialBody,
  phaseAngle: Reading<Value<"°">> | null,
  isVesselParent: boolean,
  hohmannIdealDeg: number | null,
  hohmannDeltaDeg: number | null,
  encounterDirection: "encounter" | "escape" | null,
  encounterIn: Reading<Value<"s">> | null,
  nextApsisType: -1 | 1 | null,
  nextApsisIn: Reading<Value<"s">> | null,
  held: CatalogueHeld | null = null,
): AlmanacRow[] {
  const rows: AlmanacRow[] = [];
  if (body.figures.radius !== null) {
    rows.push({
      label: "Radius",
      value: <Unit value={asOf(body.figures.radius, held)} />,
    });
  }
  if (body.figures.mass !== null) {
    rows.push({
      label: "Mass",
      value: <Unit value={asOf(body.figures.mass, held)} />,
    });
  }
  if (body.figures.surfaceGravity !== null) {
    rows.push({
      label: "Surface gravity",
      value: <Unit value={asOf(body.figures.surfaceGravity, held)} />,
    });
  }
  if (body.figures.dayLength !== null) {
    rows.push({
      label: "Day length",
      value: <Unit value={asOf(body.figures.dayLength, held)} />,
    });
  }
  if (body.tidallyLocked === true) {
    rows.push({ label: "", value: "Tidally locked" });
  }
  if (body.soi !== null) {
    rows.push({
      label: "SOI",
      value: <Unit value={asOf(value("m", body.soi), held)} />,
    });
  }
  const atmosphere = atmosphereValue(body, held);
  if (atmosphere !== null)
    rows.push({ label: "Atmosphere", value: atmosphere });
  if (body.hasOcean === true) rows.push({ label: "", value: "Has ocean" });
  if (body.hillSphere !== null) {
    rows.push({
      label: "Hill sphere",
      value: <Unit value={asOf(value("m", body.hillSphere), held)} />,
    });
  }
  if (body.rotates === false) {
    rows.push({ label: "", value: "Does not rotate" });
  }
  if (body.period !== null) {
    rows.push({
      label: "Orbital period",
      value: <Unit value={asOf(value("s", body.period), held)} />,
    });
  }
  if (body.eccentricity !== null) {
    rows.push({
      label: "Eccentricity",
      value: (
        <Unit value={asOf(value("1", body.eccentricity), held)} decimals={3} />
      ),
    });
  }
  if (body.inclination !== null) {
    rows.push({
      label: "Inclination",
      value: <Unit value={asOf(value("°", body.inclination), held)} />,
    });
  }
  if (!isVesselParent && phaseAngle !== null) {
    rows.push({
      label: "Phase angle",
      value: <ReckonedUnit value={phaseAngle} />,
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
    encounterIn !== null &&
    encounterIn.value?.isFinite() === true &&
    encounterIn.value.greaterThan(0)
  ) {
    rows.push({
      label: encounterDirection === "escape" ? "Escape in" : "Encounter in",
      value: <ReckonedUnit value={encounterIn} />,
    });
  }
  if (
    isVesselParent &&
    nextApsisType !== null &&
    nextApsisIn !== null &&
    nextApsisIn.value?.isFinite() === true &&
    !nextApsisIn.value.lessThan(0)
  ) {
    rows.push({
      label: nextApsisType === -1 ? "Next Pe" : "Next Ap",
      value: <ReckonedUnit value={nextApsisIn} />,
    });
  }
  return rows;
}
