import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

const INSTANCE = "warp-actions";

function renderAtIndex(warpRateIndex: number) {
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
  const warpCommands = () =>
    fixture.transport.sentCommands.filter(
      (c) => c.command === "time.setWarpIndex",
    );
  return { warpCommands };
}

describe("WarpControl step-down", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  it("drops the warp ladder by one rung and reports the new rate", async () => {
    const { warpCommands } = renderAtIndex(5);
    await act(async () => {});

    let result: unknown;
    act(() => {
      result = dispatchAction(INSTANCE, "step-down", {
        kind: "button",
        value: true,
      });
    });

    await waitFor(() => expect(warpCommands()).toHaveLength(1));
    expect(warpCommands()[0]?.args).toEqual({ index: 4 });
    expect(result).toEqual({ Warp: "100×" });
  });

  it("stays at realtime when already at the bottom of the ladder", async () => {
    const { warpCommands } = renderAtIndex(0);
    await act(async () => {});

    act(() => {
      dispatchAction(INSTANCE, "step-down", { kind: "button", value: true });
    });

    await waitFor(() => expect(warpCommands()).toHaveLength(1));
    expect(warpCommands()[0]?.args).toEqual({ index: 0 });
  });

  it("ignores the release of the button", async () => {
    const { warpCommands } = renderAtIndex(5);
    await act(async () => {});

    let result: unknown = "unset";
    act(() => {
      result = dispatchAction(INSTANCE, "step-down", {
        kind: "button",
        value: false,
      });
    });
    await act(async () => {});

    expect(result).toBeUndefined();
    expect(warpCommands()).toHaveLength(0);
  });
});
