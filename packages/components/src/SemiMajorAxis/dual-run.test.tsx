import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import lkoKerbin from "./__fixtures__/lko-kerbin.json";
import { SemiMajorAxisComponent } from "./index";

/** SemiMajorAxis renders its full readout, headline and reference-body subtitle, off the stream with no legacy source registered. */

describe("SemiMajorAxis: renders off the stream alone", () => {
  it("renders sma and the reference-body subtitle purely off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "system.bodies"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sma-dual" }}>
          <SemiMajorAxisComponent id="sma-dual" w={5} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: lkoKerbin["vessel.orbit.sma"],
        referenceBodyIndex: 1,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: lkoKerbin["o.referenceBody"],
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });

    await waitFor(() => expect(visibleText()).toContain("680.0 km"));
    await waitFor(() =>
      expect(screen.getByText("Semi-major axis · Kerbin")).toBeTruthy(),
    );
  });
});
