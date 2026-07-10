import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import lkoKerbin from "./__fixtures__/lko-kerbin.json";
import { SemiMajorAxisComponent } from "./index";

/**
 * R6 Wave 1 — SemiMajorAxis renders entirely off the Uplink stream.
 *
 * This file used to be a fork↔stream behavior-preservation dual-run (the
 * WarpControl pilot pattern): the SAME state rendered once off the legacy
 * `DataSource` and once off the stream, asserted byte-identical. That legacy
 * `"data"` `MockDataSource` leg is moot now that both of this widget's reads
 * are clean-home stream Topics and the fork is on its way out, so it's dropped
 * — what remains is the stream leg on its own, proving the widget renders the
 * full readout (headline `sma` + the derived reference-body subtitle) with NO
 * legacy source registered anywhere in this file.
 */
afterEach(() => {
  cleanup();
});

describe("SemiMajorAxis — renders off the stream alone (R6 Wave 1)", () => {
  it("renders sma and the derived reference-body subtitle purely off the stream", async () => {
    const fixture = setupStreamFixture({
      // `o.referenceBody` -> `vessel.state.referenceBodyName` is "carried" only
      // once ALL EIGHT `vessel.state` inputs are (see `vessel-state.ts`).
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: 10,
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
        sma: lkoKerbin["o.sma"],
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

    await waitFor(() => expect(screen.getByText("680.0 km")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByText("Semi-major axis · Kerbin")).toBeTruthy(),
    );
  });
});
