import { pressureAtAltitude, pressureFromProfile } from "@ksp-gonogo/core";
import type { ReferenceCurve } from "../Graph";
import type { StreamBody } from "../shared/streamBody";

const REFERENCE_SAMPLES = 80;

/** The pressure at an altitude, the stream's answer preferred over the model. */
export function pressureFor(
  body: StreamBody,
  altitude: number,
): number | undefined {
  if (body.pressureProfile) {
    return pressureFromProfile(body.pressureProfile, altitude);
  }
  return pressureAtAltitude(body, altitude);
}

/**
 * The reference curve. A reported profile is plotted as it arrived: the host
 * already spaced its samples on the curve's own bend. The model fallback is a
 * smooth exponential, so a fixed cadence suits it.
 */
export function buildPressureCurve(
  body: StreamBody,
  ceiling: number,
): ReferenceCurve | null {
  if (!body.hasAtmosphere) return null;
  const points = body.pressureProfile
    ? profilePoints(body.pressureProfile, ceiling)
    : modelPoints(body, ceiling);
  if (!points) return null;
  const { xs, ys } = points;
  if (xs.length === 0) return null;
  return {
    id: "pressure",
    label: `Pressure (${body.name})`,
    xs,
    ys,
    color: "var(--color-tag-blue-fg)",
  };
}

type CurvePoints = { xs: number[]; ys: number[] };

function profilePoints(
  profile: NonNullable<StreamBody["pressureProfile"]>,
  ceiling: number,
): CurvePoints {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < profile.altitudes.length; i++) {
    const altitude = profile.altitudes[i];
    if (altitude > ceiling) break;
    const p = profile.pressures[i];
    if (!(p > 0)) break;
    xs.push(altitude);
    ys.push(p);
  }
  return { xs, ys };
}

function modelPoints(body: StreamBody, ceiling: number): CurvePoints | null {
  if (!body.atmosphere) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= REFERENCE_SAMPLES; i++) {
    const altitude = (ceiling * i) / REFERENCE_SAMPLES;
    const p = pressureAtAltitude(body, altitude);
    if (p === undefined) continue;
    /* The log axis cannot show zero, and zero pressure is where the atmosphere ends, so the curve stops there. */
    if (p <= 0) break;
    xs.push(altitude);
    ys.push(p);
  }
  return { xs, ys };
}
