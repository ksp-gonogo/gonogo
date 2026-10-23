import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/** The `comms.delay` of a craft with no antenna to reach any command centre, as the mod sent it. */
const NO_PATH_DELAY = {
  oneWaySeconds: null,
  source: 0,
  meta: { source: "vessel:0556f872-7559-0466-d6d6-f7648bcd4344" },
};

describe("CommSignal: a craft with no route to any command centre", () => {
  it("reads as out of contact, not as awaiting a first signal that cannot come", () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-noroute" }}>
          <CommSignalComponent id="comm-noroute" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    expect(screen.getByText("Awaiting first signal")).toBeTruthy();

    act(() => {
      fixture.emit("comms.delay", NO_PATH_DELAY);
    });

    expect(screen.queryByText(/Awaiting first signal/)).toBeNull();
    expect(screen.getByText("No route to the craft")).toBeTruthy();
  });
});
