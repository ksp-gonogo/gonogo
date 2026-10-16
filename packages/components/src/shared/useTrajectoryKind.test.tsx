import { describe, expect, it } from "vitest";
import { type OrbitScenario, renderOrbitStream } from "../test/orbitScenario";
import { useTrajectoryKind } from "./useTrajectoryKind";

function Probe() {
  return <span data-testid="kind">{String(useTrajectoryKind())}</span>;
}

const KERBIN: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
};

function kind(container: HTMLElement): string {
  return container.querySelector('[data-testid="kind"]')?.textContent ?? "";
}

describe("useTrajectoryKind", () => {
  it("calls an orbit that clears the atmosphere an orbit", () => {
    const { container } = renderOrbitStream(<Probe />, KERBIN);
    expect(kind(container)).toBe("orbit");
  });

  it("calls a periapsis inside the atmosphere suborbital, as the orbiting verdict does", () => {
    // Periapsis about 37 km up on Kerbin, whose atmosphere reaches 70 km.
    const { container } = renderOrbitStream(<Probe />, {
      ...KERBIN,
      sma: 640000,
    });
    expect(kind(container)).toBe("suborbital");
  });

  it("calls a periapsis below the surface suborbital", () => {
    const { container } = renderOrbitStream(<Probe />, {
      ...KERBIN,
      sma: 590000,
      ecc: 0.2,
      meanAnomalyAtEpoch: 3,
    });
    expect(kind(container)).toBe("suborbital");
  });
});
