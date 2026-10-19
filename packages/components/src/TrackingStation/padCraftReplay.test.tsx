import { DashboardItemContext, PerfBudget } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { startRigReplay, wireFixture } from "../test/replayRig";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { TrackingStationComponent } from "./index";

/**
 * A craft on the launch pad, played from the wire as the rig recorded it: the craft reports its own crew and link from the first second, a second or two before the centre's roster lists it.
 */

async function mountAt(seconds: number) {
  installSizedResizeObserver({ w: 1000, h: 700 });
  const replay = startRigReplay(wireFixture("pad-craft-loading"));
  const view = render(
    <replay.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "pad" }}>
        <WidgetContributions Widget={TrackingStationComponent}>
          <TrackingStationComponent
            config={{ frame: "Kerbin" } as never}
            id="pad"
            w={12}
            h={14}
          />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </replay.Provider>,
  );
  for (let second = 0; second <= seconds; second++) {
    for (const b of PerfBudget.getAll()) b.reset();
    await act(async () => {
      replay.advanceTo(second);
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  return view;
}

async function selectPadCraft() {
  fireEvent.click(await screen.findByRole("button", { name: "Active vessel" }));
  return screen.findByRole("complementary", { name: "LFV-2 Wave" });
}

describe("TrackingStation: a craft on the pad", () => {
  it("shows the crew and link the craft reports, not 'unknown'", async () => {
    await mountAt(3);
    const panel = await selectPadCraft();

    expect(panel).toHaveTextContent(/Crew\s*0\/0/);
    expect(panel).toHaveTextContent(/Comms\s*connected/);
    expect(panel).not.toHaveTextContent("unknown");
  }, 60_000);
});
