import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

// Both reads run off a real `TelemetryProvider`, with no legacy `MockDataSource`.

describe("SemiMajorAxisComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderSma(size: { w: number; h: number } = { w: 5, h: 6 }) {
    // The default size meets the subtitle threshold (rows 5, cols 4).
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
      // Kerbin radius 600 km plus 75 km altitude.
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
