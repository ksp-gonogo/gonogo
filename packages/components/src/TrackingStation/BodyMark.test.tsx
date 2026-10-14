import {
  ANALYTIC_BODY_HORIZON,
  type BodyPoseCurrency,
} from "@ksp-gonogo/sitrep-client";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { BodyMark } from "./BodyMark";
import { placeBodies } from "./diagramGeometry";
import { INERTIAL_PLACEMENT } from "./projection";
import type { CelestialBody } from "./useCelestialBodies";

const MUN: CelestialBody = {
  index: 2,
  name: "Mun",
  referenceBody: "Kerbin",
  radius: 200_000,
  soi: null,
  gravParameter: null,
  semiMajorAxis: 12_000_000,
  eccentricity: 0,
  inclination: 0,
  lan: 0,
  argumentOfPeriapsis: 0,
  meanAnomalyAtEpoch: null,
  epoch: null,
  horizon: ANALYTIC_BODY_HORIZON,
  deterministic: true,
  period: null,
  mass: null,
  geeASL: null,
  escapeVelocity: null,
  hillSphere: null,
  rotationPeriod: null,
  initialRotation: null,
  tidallyLocked: null,
  rotates: null,
  hasOcean: null,
  description: null,
  atmosphere: null,
  hasAtmosphere: null,
  maxAtmosphere: null,
  hasOxygen: null,
  figures: {
    radius: null,
    mass: null,
    surfaceGravity: null,
    dayLength: null,
    atmosphereDepth: null,
  },
};

/** The Mun placed by the diagram's own placement from a pose of the given currency. */
function placedMun(currency: BodyPoseCurrency) {
  const placed = placeBodies({
    parent: null,
    children: [MUN],
    poses: {
      ut: 200,
      poseByIndex: {
        2: {
          index: 2,
          currency,
          atUt: 100,
          asOfUt: currency === "held" ? 100 : null,
          untilUt: null,
          position: [0, 0, 0],
          velocity: [0, 0, 0],
          trueAnomaly: 30,
        },
      },
    },
    placement: INERTIAL_PLACEMENT,
    plotScale: 1e-5,
  });
  return { mun: placed.bodies[0], parent: placed.parent };
}

function mark(currency: BodyPoseCurrency) {
  const { mun, parent } = placedMun(currency);
  return render(
    <svg>
      <title>diagram</title>
      <BodyMark
        placed={mun}
        parentAt={parent}
        zoom={1}
        tone="plain"
        phaseAngle={undefined}
        transferStatus={undefined}
        onHoverStart={() => {}}
        onHoverEnd={() => {}}
        pinned={false}
        onActivate={() => {}}
      />
    </svg>,
  );
}

/** A body placed from a held pose says so, by its mark and by its name, as a held craft does. */
describe("BodyMark", () => {
  it("draws a body placed from a held pose dimmed and dashed, and names it held", () => {
    const { container } = mark("held");

    const dot = container.querySelector('[data-body="Mun"]');
    expect(dot).toHaveAttribute("data-body-held");
    expect(dot).toHaveAttribute("stroke-dasharray");
    expect(dot).toHaveAttribute("fill-opacity", "0.5");
    expect(
      screen.getByRole("button", { name: "Mun, held" }),
    ).toBeInTheDocument();
  });

  it("draws a body placed from a current pose at full strength", () => {
    const { container } = mark("exact");

    const dot = container.querySelector('[data-body="Mun"]');
    expect(dot).not.toHaveAttribute("data-body-held");
    expect(dot).not.toHaveAttribute("stroke-dasharray");
    expect(screen.getByRole("button", { name: "Mun" })).toBeInTheDocument();
  });
});
