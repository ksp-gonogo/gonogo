import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { ShipDiagram } from "./ShipDiagram";
import type { ShipMapPart } from "./shipTopology";

/**
 * Baseline a11y smoke for the Ship Map diagram across the visible
 * overlay paths: engine flame, parachute canopy, deploy chevron,
 * highlight ring. The `aria-label` per part-group is composed in
 * `partAriaLabel`; a regression to that path is the most likely
 * accessibility issue this catches.
 */

function half(size: { x: number; y: number; z: number }) {
  return {
    size,
    latHalfExtent: size.x / 2,
    axialHalfExtent: size.y / 2,
    rotationRad: 0,
  };
}

const POD: ShipMapPart = {
  flightId: 1,
  parentFlightId: null,
  name: "mk1pod",
  title: "Mk1 Command Pod",
  type: "capsule",
  lat: 0,
  axial: 0,
  ...half({ x: 1.25, y: 1.14, z: 1.25 }),
  dryMass: 0.8,
  stage: 0,
  maxTemp: 1200,
};
const CHUTE: ShipMapPart = {
  flightId: 2,
  parentFlightId: 1,
  name: "parachuteSingle",
  title: "Mk16 Parachute",
  type: "parachute",
  lat: 0,
  axial: 0.66,
  ...half({ x: 0.63, y: 0.36, z: 0.61 }),
  dryMass: 0.1,
  stage: 0,
  maxTemp: 1200,
  partState: [{ type: "parachute", state: "deploying" }],
};
const ENGINE: ShipMapPart = {
  flightId: 3,
  parentFlightId: 1,
  name: "liquidEngine",
  title: "LV-T45 Liquid Fuel Engine",
  type: "engine",
  lat: 0,
  axial: -2,
  ...half({ x: 1.25, y: 1.65, z: 1.25 }),
  dryMass: 1.5,
  stage: 1,
  maxTemp: 2000,
  partState: [{ type: "engine", state: "active" }],
};
const SOLAR: ShipMapPart = {
  flightId: 4,
  parentFlightId: 1,
  name: "solarPanel",
  title: "OX-STAT Photovoltaic Panel",
  type: "solar",
  lat: 0.5,
  axial: -0.5,
  ...half({ x: 0.5, y: 0.05, z: 0.5 }),
  dryMass: 0.005,
  stage: 0,
  maxTemp: 1200,
  partState: [{ type: "solarPanel", state: "deploying" }],
};

describe("ShipDiagram a11y", () => {
  it("has no axe violations rendering a representative vessel", async () => {
    const { container } = render(
      <ShipDiagram
        parts={[POD, CHUTE, ENGINE, SOLAR]}
        highlight="LV-T45 Liquid Fuel Engine"
        width={400}
        height={400}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations on the empty-parts placeholder", async () => {
    const { container } = render(
      <ShipDiagram parts={[]} width={200} height={200} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
