import { act } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { type OrbitScenario, renderOrbitStream } from "../test/orbitScenario";
import type { StreamFixture } from "../test/setupStreamFixture";
import { useTrajectoryKind } from "./useTrajectoryKind";

function Probe() {
  return <span data-testid="kind">{String(useTrajectoryKind())}</span>;
}

const KERBIN: OrbitScenario = {
  bodyName: "Kerbin",
  sma: 681500,
  ecc: 0.005,
};

/** The scenario puts the craft on the ground; these are about a craft in flight. */
function inFlight(fixture: StreamFixture): void {
  act(() => {
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Test Vessel",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 0,
      launchUt: 0,
    });
  });
}

function kind(container: HTMLElement): string {
  return container.querySelector('[data-testid="kind"]')?.textContent ?? "";
}

describe("useTrajectoryKind", () => {
  it("calls an orbit that clears the atmosphere an orbit", () => {
    const { container, fixture } = renderOrbitStream(<Probe />, KERBIN);
    inFlight(fixture);
    expect(kind(container)).toBe("orbit");
  });

  it("calls a periapsis inside the atmosphere suborbital, as the orbiting verdict does", () => {
    // Periapsis about 37 km up on Kerbin, whose atmosphere reaches 70 km.
    const { container, fixture } = renderOrbitStream(<Probe />, {
      ...KERBIN,
      sma: 640000,
    });
    inFlight(fixture);
    expect(kind(container)).toBe("suborbital");
  });

  it("calls a periapsis below the surface suborbital", () => {
    const { container, fixture } = renderOrbitStream(<Probe />, {
      ...KERBIN,
      sma: 590000,
      ecc: 0.2,
      meanAnomalyAtEpoch: 3,
    });
    inFlight(fixture);
    expect(kind(container)).toBe("suborbital");
  });
});
