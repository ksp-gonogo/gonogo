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
 * CHARACTERISATION: what `undefined` MEANS at each of WarpControl's read sites
 * today, recorded before `useTelemetry` returns a `Reading`.
 *
 * Three different meanings live in this one widget, and only one of them is
 * visible to the operator:
 *
 *   - `warpRate` absent -> `magnitudeOf` gives null -> NULL_DISPLAY. Honest
 *   - `warpRateIndex` absent -> `currentIndex` null. The full ladder shows no
 *     level pressed (honest), but the STEPPER coerces it through `idx =
 *     currentIndex ?? 0` and then asserts realtime: 1x pressed, warp-down
 *     disabled, off no data at all
 *   - `paused` absent -> `effectivePaused` undefined -> the pause button reads
 *     "Pause game", and pressing it sends `{ paused: true }`, a command built
 *     by inverting a value that never arrived
 *
 * The scene read has a fourth meaning again: absent means "no game signal",
 * which SUPPRESSES the dimming overlay, so a widget fed nothing looks live.
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

const INSTANCE = "warp-characterise";

function mount(w: number, h: number) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 0 });
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

    // `magnitudeOf(undefined)` -> null -> `formatRate(null)` -> NULL_DISPLAY.
    expect(
      screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
    ).toBeTruthy();
    // `normalizeWarpMode(undefined)` -> null, and the caption is gated on
    // `mode !== null`, so absence renders no caption rather than an unknown one.
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.queryByText("Physics")).toBeNull();
  });

  it("does NOT dim the body: an absent scene read means 'no game signal', which suppresses the overlay", () => {
    mount(6, 5);

    // `dimBody = hasGameSignal && !warpableScene`. With nothing arrived
    // `hasGameSignal` is false, so the no-warp-scene overlay never shows and
    // the widget presents as fully operable off zero telemetry.
    expect(screen.queryByText("No active save")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Time warp levels" }),
    ).toBeTruthy();
  });

  it("the full ladder shows NO level as current", () => {
    mount(6, 5);

    // `active = currentIndex === lvl.index` and `currentIndex` is null, so the
    // ladder makes no claim. This is the honest half of the same absent read
    // the stepper below coerces.
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
    // 4x3 is below the full ladder's area threshold, so this is the stepper leg.
    mount(4, 3);

    expect(
      screen.getByRole("group", { name: "Time warp controls" }),
    ).toBeTruthy();
    // `idx = currentIndex ?? 0`: nothing arrived becomes warp level zero, and
    // the widget then states it. Indistinguishable from a confirmed 1x.
    expect(
      screen
        .getByRole("button", { name: "Drop to realtime" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // Same coercion, second consequence: the operator is told they cannot warp
    // down because we are already at the bottom, which we do not know.
    expect(screen.getByRole("button", { name: "Warp down" })).toBeDisabled();
  });

  it("the stepUp action steps to index 1, treating the absent index as 0", async () => {
    const { commandHandler } = mount(4, 3);
    const { dispatchAction } = await import("@ksp-gonogo/core");

    await act(async () => {
      await dispatchAction(INSTANCE, "stepUp", { kind: "button", value: true });
    });

    // `(currentIndex ?? 0) + 1`. A serial-input step up with no telemetry
    // commands 5x, not "refuse until we know where we are".
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

    // The pause button only renders in the Flight scene, so land that (and
    // only that): `time.warp` stays cold, which is the case under test.
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
    });

    const button = await screen.findByRole("button", { name: "Pause game" });
    // `effectivePaused === true` is false for an absent read, so the widget
    // shows the pause affordance rather than an unknown state.
    expect(screen.queryByRole("button", { name: "Resume game" })).toBeNull();

    act(() => {
      button.click();
    });

    // `next = !effectivePaused` inverts `undefined` to `true`: a command built
    // out of the absence of a value.
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

    // Land a whole record first, so the partial one below is provably
    // delivered: NULL_DISPLAY is also the never-arrived render, and asserting
    // it from a cold mount would prove nothing.
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

    // A field missing from an arrived record is read exactly like a record that
    // never arrived: the widget DISCARDS the rate and the mode it had rather
    // than holding the last known.
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
    // `magnitudeOf` folds null and undefined into the same null, and
    // `typeof indexRaw === "number"` rejects both, so a confirmed "there is no
    // warp state" and "nothing has arrived" render identically. Pinned as a
    // conflation, not as a distinction.
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

    // `warp?.warpRate` erases the store's confirmed absence, so the operator
    // cannot tell "the mod says there is no warp state" from "still waiting".
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: `Time warp rate ${NULL_DISPLAY}` }),
      ).toBeTruthy(),
    );
  });
});
