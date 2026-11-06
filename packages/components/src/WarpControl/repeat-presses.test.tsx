import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

const INSTANCE = "warp-repeat";

function mount(warpRateIndex: number) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <WarpControlComponent id={INSTANCE} w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 1,
      warpRateIndex,
      warpMode: 0,
      paused: false,
    });
  });
  const sent = (command: string) =>
    fixture.transport.sentCommands.filter((c) => c.command === command);
  return { fixture, sent };
}

const press = (action: string) =>
  dispatchAction(INSTANCE, action, { kind: "button", value: true });

describe("WarpControl presses before the game's reading moves", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  it("steps from the last commanded rung, so two step-ups climb two rungs", async () => {
    const { sent } = mount(2);
    await act(async () => {});

    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = press("step-up");
    });
    await act(async () => {
      second = press("step-up");
    });

    await waitFor(() => expect(sent("time.setWarpIndex")).toHaveLength(2));
    expect(sent("time.setWarpIndex").map((c) => c.args)).toEqual([
      { index: 3 },
      { index: 4 },
    ]);
    expect(first).toEqual({ Warp: "50×" });
    expect(second).toEqual({ Warp: "100×" });
  });

  it("sends the opposite pause state on a second press made in the same frame", async () => {
    const { sent } = mount(0);
    await act(async () => {});

    await act(async () => {
      press("toggle-pause");
      press("toggle-pause");
    });

    await waitFor(() => expect(sent("time.setPaused")).toHaveLength(2));
    expect(sent("time.setPaused").map((c) => c.args)).toEqual([
      { paused: true },
      { paused: false },
    ]);
  });
});
