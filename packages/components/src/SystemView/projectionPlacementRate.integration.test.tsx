import {
  ContributionsProvider,
  PerfBudget,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const system = {
  bodies: [
    {
      index: KERBOL_INDEX,
      name: "Kerbol",
      parentIndex: null,
      radius: 261_600_000,
      gravParameter: 1.1723328e18,
      orbit: null,
    },
    {
      index: KERBIN_INDEX,
      name: "Kerbin",
      parentIndex: KERBOL_INDEX,
      radius: 600_000,
      gravParameter: 3.5316e12,
      sphereOfInfluence: 84_159_286,
      isHome: true,
      orbit: {
        sma: 13_599_840_256,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1,
        epoch: 0,
      },
    },
    {
      index: MUN_INDEX,
      name: "Mun",
      parentIndex: KERBIN_INDEX,
      radius: 200_000,
      gravParameter: 6.5138398e10,
      sphereOfInfluence: 2_429_559,
      orbit: {
        sma: 12_000_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1.7,
        epoch: 0,
      },
    },
  ],
};

const WIDGET_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.projection"] as const,
};

describe("SystemView placement rate", () => {
  it("places nothing further while frames arrive inside one UT bucket, with the stock Control Frame elected", async () => {
    const placementBudget = PerfBudget.getAll().find(
      (b) => b.name === "SystemView body placements/sec",
    );
    expect(placementBudget).toBeDefined();
    const record = vi.spyOn(placementBudget as PerfBudget, "record");

    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={WIDGET_META}>
          <ContributionsProvider>
            <SystemViewComponent
              config={{ frame: "Kerbin" } as never}
              id="sv"
            />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.bodies", system);
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('circle[data-body="Mun"]'),
      ).not.toBeNull();
    });
    await act(async () => {});

    const settled = record.mock.calls.length;
    for (let i = 0; i < 30; i++) {
      act(() => {
        fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
      });
    }
    await act(async () => {});

    expect(record.mock.calls.length - settled).toBe(0);
  });
});
