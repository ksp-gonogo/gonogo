import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/**
 * What WarpControl does when `time.warp` stops being current: it keeps drawing
 * it, and this file records that as a decision rather than an oversight.
 *
 * Warp rate, warp index, warp mode and pause are discrete simulation modes. They
 * move when something sets them, and nothing can set them down a link that is
 * not delivering, so the last state received is still the state the simulation
 * is in. There is no drift to age.
 *
 * Withholding them would not read as "unknown", which is the point worth pinning.
 * The stepper coerces its index through `currentIndex ?? 0`, so a withheld index
 * renders as 1x pressed and warp-down disabled: a refusal to answer would come
 * out of the widget as a positive claim that the simulation is at realtime, which
 * is exactly the assertion it had just stopped being entitled to make. The
 * panel's stream-status badge carries the freshness.
 */

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const CARRIED = [
  "time.warp",
  "time.setWarpIndex",
  "time.setPaused",
  "spaceCenter.scene",
];

const INSTANCE = "warp-stale";

function mount(w: number, h: number) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 0,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <WarpControlComponent id={INSTANCE} w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

/** 10x high warp, index 2. */
function emitWarp(fixture: ReturnType<typeof mount>): void {
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 10,
      warpRateIndex: 2,
      warpMode: 0,
      paused: false,
    });
  });
}

/** Drop the link, then advance a frame: nothing else re-samples currency. */
function goStale(fixture: ReturnType<typeof mount>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("WarpControl when time.warp is no longer current", () => {
  it("holds the rate and the mode caption rather than blanking them", async () => {
    const fixture = mount(6, 5);
    emitWarp(fixture);
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );

    goStale(fixture);

    // Held deliberately: warp does not tick away between updates, and the dash
    // below is reserved for a rate nobody has ever sent us.
    expect(
      screen.getByRole("img", { name: "Time warp rate 10×" }),
    ).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
    ).toBeNull();
  });

  it("keeps the ladder pointed at the level the simulation was last set to", async () => {
    const fixture = mount(6, 5);
    emitWarp(fixture);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "10×" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );

    goStale(fixture);

    expect(
      screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "1×" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("does not fall back into asserting realtime on the stepper", async () => {
    // The reason this widget holds rather than withholds. 4x3 is the stepper leg,
    // where `currentIndex ?? 0` turns an unanswered index into a pressed 1x and a
    // disabled warp-down: a claim about the simulation built out of not knowing.
    const fixture = mount(4, 3);
    emitWarp(fixture);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Warp down" })).toBeEnabled(),
    );

    goStale(fixture);

    expect(
      screen
        .getByRole("button", { name: "Drop to realtime" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Warp down" })).toBeEnabled();
  });

  it("still renders the never-arrived state for a topic that never arrived", () => {
    // The other side of the decision: holding a value is only honest if the
    // widget has a distinct render for having nothing to hold. A cold mount does,
    // so a held 10x cannot be mistaken for a widget that invented one.
    mount(6, 5);

    expect(
      screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
    ).toBeTruthy();
    expect(screen.queryByText("High")).toBeNull();
  });
});
