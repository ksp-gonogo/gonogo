import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

const UT_NOW = 1_000_000;
const OWLT = 240;

describe("CurrentOrbit under signal delay", () => {
  it("counts to each apsis from the received edge, with the conic's figure for the craft's present beside it", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "system.bodies"],
      delaySeconds: OWLT,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-delay" }}>
          <CurrentOrbitComponent id="orbit-delay" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0.1,
          inc: 0,
          lan: 0,
          argPe: 0,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          meanAnomalyAtEpoch: 0,
          epoch: UT_NOW - OWLT,
        },
        {
          validAt: UT_NOW - OWLT,
          deliveredAt: UT_NOW,
          quality: Quality.OnRails,
        },
      );
    });

    await waitFor(() =>
      expect(
        container.querySelectorAll("[data-modelled-alongside]").length,
      ).toBe(2),
    );
    const [toAp] = container.querySelectorAll("[data-modelled-alongside]");
    const observed = toAp?.parentElement?.firstChild?.textContent ?? "";
    expect(observed).toMatch(/^\d/);
    expect(toAp?.textContent).not.toBe(observed);
    expect(toAp?.querySelector("[data-held-mark]")).not.toBeNull();
  });
});
