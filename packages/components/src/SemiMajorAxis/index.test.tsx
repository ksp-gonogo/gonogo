import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

// `sma` reads the raw `vessel.orbit.sma` element; `referenceBody` names
// `vessel.orbit.referenceBodyIndex` against `system.bodies`. Both run off a
// real `TelemetryProvider` here: no legacy `MockDataSource` is registered
// anywhere in this file.
const SEMI_MAJOR_AXIS_CHANNELS = ["vessel.orbit", "system.bodies"];

describe("SemiMajorAxisComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: SEMI_MAJOR_AXIS_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderSma(size: { w: number; h: number } = { w: 5, h: 6 }) {
    // Default render size meets the subtitle threshold (rows≥5, cols≥4)
    // so tests that assert on the "Semi-major axis · Kerbin" subtitle
    // continue to exercise it. Below the threshold the widget hides the
    // subtitle to keep the value readout from crowding.
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sma-test" }}>
          <SemiMajorAxisComponent
            config={{}}
            id="sma-test"
            w={size.w}
            h={size.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("shows the empty state before any orbit data arrives", async () => {
    renderSma();
    expect(await screen.findByText(/no orbit data/i)).toBeInTheDocument();
  });

  it("renders SMA via formatDistance and includes the reference body subtitle", async () => {
    renderSma();
    act(() => {
      // SMA from body centre: Kerbin radius 600km + 75km altitude = 675km.
      stream.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });
    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(screen.getByText(/Kerbin/)).toBeInTheDocument();
  });
});
