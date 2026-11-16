import { PerfBudget } from "@ksp-gonogo/core";
import { TargetKind, type VesselTarget } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { craftGeometry, craftOrbitFigure } from "./geometry/craft";
import {
  type RendezvousGeometry,
  useRendezvousGeometry,
} from "./useRendezvousGeometry";

const NOW = 1_000_000;

const chaserOrbit = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0.01,
  inc: 0.1,
  lan: 0.2,
  argPe: 0.3,
  meanAnomalyAtEpoch: 0.4,
  epoch: NOW,
  mu: 3.5316e12,
};
const targetOrbit = {
  ...chaserOrbit,
  sma: 720_000,
  ecc: 0.02,
  inc: 0.12,
  meanAnomalyAtEpoch: 0.5,
};

const target = {
  name: "Station",
  kind: TargetKind.Vessel,
  vesselId: "target",
  bodyIndex: null,
  orbit: targetOrbit as never,
  meta: {} as never,
} as VesselTarget;

let geometry: RendezvousGeometry | undefined;

function Probe() {
  geometry = useRendezvousGeometry(target, true, 5000);
  return null;
}

describe("useRendezvousGeometry", () => {
  it("builds the two orbit outlines once while the view's instant moves every frame", () => {
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("craftOrbitFigure"),
    );
    if (!budget)
      throw new Error("the craftOrbitFigure budget is not registered");
    const fixture = setupStreamFixture({ pinnedUt: NOW, suspendFrames: true });
    fixture.client.subscribe("vessel.orbit", () => {});
    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.orbit", chaserOrbit);
    });
    expect(geometry?.craft).not.toBeNull();
    budget.reset();
    const before = geometry?.craft?.relative;
    for (let i = 1; i <= 60; i++) {
      act(() => fixture.scrubTo(NOW + i / 60));
    }
    expect(budget.windowTotal()).toBe(0);
    // The instant still moves the craft: only the outlines are held.
    expect(geometry?.craft?.relative).not.toEqual(before);
  });

  it("gives the same geometry from a held figure as from one built in place", () => {
    const chaser = chaserOrbit;
    const theirs = targetOrbit;
    const input = { chaser, target: theirs, ut: NOW + 12 };
    expect(
      craftGeometry({ ...input, figure: craftOrbitFigure(chaser, theirs) }),
    ).toEqual(craftGeometry(input));
  });
});
