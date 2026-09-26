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
 * WarpControl keeps drawing `time.warp` when it stops being current. Warp state
 * is a set of discrete simulation modes with no drift to age, and withholding
 * the index would make the stepper claim realtime. The panel's stream-status
 * badge carries the freshness.
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

    // The dash is reserved for a rate nobody has ever sent.
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
    // 4x3 is the stepper, where an unanswered index would render as a pressed 1x and a disabled warp-down.
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
    // Holding is only honest if a cold mount renders distinctly, so a held 10x cannot be mistaken for an invented one.
    mount(6, 5);

    expect(
      screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
    ).toBeTruthy();
    expect(screen.queryByText("High")).toBeNull();
  });
});
