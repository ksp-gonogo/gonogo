import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/**
 * Pins what each of WarpControl's reads renders when its value is absent. Only
 * the rate reads honestly: an absent index makes the stepper claim realtime,
 * an absent `paused` inverts into a real command, and an absent scene
 * suppresses the dimming overlay.
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

const INSTANCE = "warp-characterise";

function mount(w: number, h: number) {
  const fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <WarpControlComponent id={INSTANCE} w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler };
}

/** Every rung of the full ladder, by its rendered label. */
const LADDER_LABELS = [
  "1×",
  "5×",
  "10×",
  "50×",
  "100×",
  "1k×",
  "10k×",
  "100k×",
];

describe("WarpControl: nothing has arrived at all", () => {
  it("renders the rate as NULL_DISPLAY, with no mode caption", () => {
    mount(6, 5);

    expect(
      screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
    ).toBeTruthy();
    // Absence renders no caption rather than an unknown one.
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.queryByText("Physics")).toBeNull();
  });

  it("does NOT dim the body: an absent scene read means 'no game signal', which suppresses the overlay", () => {
    mount(6, 5);

    // With nothing arrived there is no game signal, so the no-warp-scene overlay never shows.
    expect(screen.queryByText("No active save")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Time warp levels" }),
    ).toBeTruthy();
  });

  it("the full ladder shows NO level as current", () => {
    mount(6, 5);

    // The ladder makes no claim; the stepper below coerces the same absent read.
    for (const label of LADDER_LABELS) {
      expect(
        screen
          .getByRole("button", { name: label })
          .getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });
});

describe("WarpControl: the `currentIndex ?? 0` coercion", () => {
  it("the stepper asserts realtime, and disables warp-down, off a read that never arrived", () => {
    // 4x3 is below the full ladder's area threshold, so this is the stepper.
    mount(4, 3);

    expect(
      screen.getByRole("group", { name: "Time warp controls" }),
    ).toBeTruthy();
    // `idx = currentIndex ?? 0`: nothing arrived reads as a confirmed 1x.
    expect(
      screen
        .getByRole("button", { name: "Drop to realtime" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // Same coercion: warp-down is disabled as if already at the bottom.
    expect(screen.getByRole("button", { name: "Warp down" })).toBeDisabled();
  });

  it("the stepUp action steps to index 1, treating the absent index as 0", async () => {
    const { commandHandler } = mount(4, 3);
    const { dispatchAction } = await import("@ksp-gonogo/core");

    await act(async () => {
      await dispatchAction(INSTANCE, "stepUp", { kind: "button", value: true });
    });

    // A step up with no telemetry commands 5x rather than refusing.
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
        index: 1,
      }),
    );
  });

  it("a ladder click dispatches unconditionally: there is no absence gate on the command path", async () => {
    const { commandHandler } = mount(6, 5);

    act(() => {
      screen.getByRole("button", { name: "10×" }).click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
        index: 2,
      }),
    );
  });
});

describe("WarpControl: the absent `paused` read", () => {
  it("reads as not-paused and commands a PAUSE on click", async () => {
    const { fixture, commandHandler } = mount(6, 5);

    // Only the Flight scene renders the pause button; `time.warp` stays cold.
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    const button = await screen.findByRole("button", { name: "Pause game" });
    expect(screen.queryByRole("button", { name: "Resume game" })).toBeNull();

    act(() => {
      button.click();
    });

    // `!effectivePaused` inverts `undefined` into a real command.
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setPaused", {
        paused: true,
      }),
    );
  });
});

describe("WarpControl: a partial payload", () => {
  it("a time.warp record missing warpRate/warpRateIndex/warpMode reverts to the unknown render", async () => {
    const { fixture } = mount(6, 5);

    // A whole record lands first, so the partial one below is provably delivered.
    act(() => {
      fixture.emit("time.warp", {
        warpRate: 10,
        warpRateIndex: 2,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("High")).toBeTruthy();

    act(() => {
      fixture.emit("time.warp", { paused: false });
    });

    // A field missing from an arrived record discards the last known value.
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("High")).toBeNull();
    expect(
      screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("WarpControl: null versus undefined", () => {
  it("NULL fields are read exactly like absent ones: this widget does not distinguish them", async () => {
    // A confirmed "no warp state" and "nothing arrived" render identically: a conflation, not a distinction.
    const { fixture } = mount(6, 5);

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 10,
        warpRateIndex: 2,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );

    act(() => {
      fixture.emit("time.warp", {
        warpRate: null,
        warpRateIndex: null,
        warpMode: null,
        paused: null,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("High")).toBeNull();
  });

  it("a whole-topic tombstone reads exactly like nothing having arrived", async () => {
    const { fixture } = mount(6, 5);

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 10,
        warpRateIndex: 2,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );

    act(() => {
      fixture.emit("time.warp", null);
    });

    // The operator cannot tell "the mod says there is no warp state" from "still waiting".
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
      ).toBeTruthy(),
    );
  });
});
