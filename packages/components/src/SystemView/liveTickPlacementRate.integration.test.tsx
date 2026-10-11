import {
  ContributionsProvider,
  PerfBudget,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** The view clock mints a frame per animation frame, so the whole diagram sees a new pose at this rate. */
const LIVE_FRAMES_PER_SECOND = 30;
const LIVE_SECONDS = 10;
const WARP = 1;

describe("SystemView placement rate under a live clock", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays well under the placement budget while the clock and the craft tick every frame", async () => {
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "SystemView body placements/sec",
    ) as PerfBudget;
    const record = vi.spyOn(budget, "record");
    let wallMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => wallMs);

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
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "v",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: KERBIN_INDEX,
        launchUt: null,
      });
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('circle[data-body="Mun"]'),
      ).not.toBeNull();
    });
    await act(async () => {});

    const settled = record.mock.calls.length;
    const frames = LIVE_FRAMES_PER_SECOND * LIVE_SECONDS;
    for (let i = 1; i <= frames; i++) {
      wallMs += 1000 / LIVE_FRAMES_PER_SECOND;
      const ut = (i / LIVE_FRAMES_PER_SECOND) * WARP;
      act(() => {
        fixture.emit(
          "vessel.orbit",
          {
            referenceBodyIndex: KERBIN_INDEX,
            sma: 800_000,
            ecc: 0.01,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: ut * 0.001,
            epoch: ut,
            mu: 3.5316e12,
            patches: [],
          },
          { validAt: ut, deliveredAt: ut },
        );
        fixture.scrubTo(ut);
      });
    }
    await act(async () => {});
    const perSecond = (record.mock.calls.length - settled) / LIVE_SECONDS;
    // Body rings are re-placed once a UT bucket and the points every frame, about 300 a second here; a ring placed on every frame is about 3,000 a second for this three-body system and far more for a real one.
    expect(perSecond).toBeLessThan(budget.threshold / 20);
  });
});
