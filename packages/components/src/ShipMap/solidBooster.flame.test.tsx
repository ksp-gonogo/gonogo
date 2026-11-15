import type { PartStateModule, VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type PartLiveWireInput,
  topologyToVesselPartsWire,
} from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePrelaunchPartState from "./__fixtures__/fuelline-tester-22parts-prelaunch.partState.json";
import { ShipMapComponent } from "./index";

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;
const ACTIVE = new Map<number, PartLiveWireInput>(
  Object.entries(fuellinePrelaunchPartState as Record<string, unknown>)
    .filter(([key]) => key !== "_comment")
    .map(([flightId, modules]) => [
      Number(flightId),
      {
        partState: {
          seq: 0,
          modules: Array.isArray(modules) ? (modules as PartStateModule[]) : [],
        },
      },
    ]),
);

/** One of the fixture's three active engines carries solid fuel, so it classifies as a booster. */
function partsWithOneBooster() {
  const boosterId = 965970713;
  const live = new Map(ACTIVE);
  const base = live.get(boosterId);
  if (base === undefined) throw new Error("fixture has no active engine");
  live.set(boosterId, {
    ...base,
    resources: {
      SolidFuel: { amount: 100, maxAmount: 100, flow: 0, nominalFlow: 0 },
    },
  } as PartLiveWireInput);
  return topologyToVesselPartsWire(TOPOLOGY, live);
}

function control(throttle: number) {
  return {
    sas: false,
    sasMode: 0,
    rcs: false,
    gear: false,
    brakes: false,
    lights: false,
    actionGroups: [],
    throttle,
  };
}

function flames(container: HTMLElement): number {
  return container.querySelectorAll('g[data-role="engine-flame"]').length;
}

describe("ShipMap: a solid booster burns without throttle", () => {
  it("flames only the booster at zero throttle while the vessel makes thrust, and none once it stops", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const { container } = render(
      <fixture.Provider>
        <ShipMapComponent id="ship-map-srb" w={8} h={10} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.parts", partsWithOneBooster());
      fixture.emit("vessel.control", control(0));
      fixture.emit("vessel.propulsion", {
        currentThrust: 250,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Ship diagram")).toBeTruthy(),
    );
    await waitFor(() => expect(flames(container)).toBe(1));

    act(() => {
      fixture.emit("vessel.propulsion", {
        currentThrust: 0,
      });
    });
    await waitFor(() => expect(flames(container)).toBe(0));
    await act(async () => {});
  });
});
