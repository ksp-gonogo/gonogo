import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const ENCOUNTER_UT = 30_000;

const NO_ENCOUNTER_ORBIT = {
  referenceBodyIndex: 1,
  sma: 3_000_000,
  ecc: 0.1,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: KERBIN_MU,
  horizon: { kind: 1, trajectoryKind: 1 },
};

function system() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
        },
      },
      {
        index: 2,
        name: "Mun",
        parentIndex: 1,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
        },
      },
    ],
  };
}

describe("TrackingStation's held route line", () => {
  it("keeps its row while fresh reports and the record trade which is newer", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    const view = render(
      <fixture.Provider>
        <TrackingStationComponent
          config={{ frame: "Kerbin" } as never}
          id="sv-held-row"
          w={10}
          h={12}
        />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("trackingStation.bodies", system());
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Active Craft",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 1,
      });
      fixture.emit("trackingStation.catalog", {
        entries: [
          {
            vesselId: "v-active",
            name: "Active Craft",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            placeAsOfUt: 500,
            orbit: { ...NO_ENCOUNTER_ORBIT, sma: 4_000_000 },
          },
        ],
      });
      fixture.emit("vessel.orbit", { ...NO_ENCOUNTER_ORBIT, epoch: 400 });
    });
    await waitFor(() => {
      expect(
        view.container.querySelector("[data-held-plan-caption]"),
      ).not.toBeNull();
    });
    const slot = view.container.querySelector("[data-held-plan-slot]");
    expect(slot).not.toBeNull();
    const shown: boolean[] = [];
    for (const epoch of [600, 450, 700, 480, 1000, 420]) {
      act(() => {
        fixture.emit("vessel.orbit", { ...NO_ENCOUNTER_ORBIT, epoch });
      });
      expect(view.container.querySelector("[data-held-plan-slot]")).toBe(slot);
      shown.push(
        view.container.querySelector("[data-held-plan-caption]") !== null,
      );
    }
    expect(shown).toContain(true);
    expect(shown).toContain(false);
    await act(async () => {});
  });
});
