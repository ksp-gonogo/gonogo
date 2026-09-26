import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WarpIntentProvider } from "../shared/WarpIntent";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/** WarpControl running off a real stream pipeline fed via `StubTransport`, with no legacy source registered. */
// Reset at the start of each test, once the prior test's tree is already unmounted.
beforeEach(() => {
  clearActionHandlers();
});

describe("WarpControl: genuinely runs off the stream", () => {
  it("reads the recorded time.warp state off the real stream pipeline, not legacy", async () => {
    // With no legacy source registered, a read that fell back would stay NULL_DISPLAY rather than reach "10×".
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-stream" }}>
          <WarpControlComponent id="warp-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText(NULL_DISPLAY)).toBeTruthy();

    // StubTransport.emit is subscription-gated, so delivery proves a real subscription.
    expect(fixture.transport.isSubscribed("time.warp")).toBe(true);

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
    // WarpMode 0 is High.
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("a warp-ladder click dispatches a COMMAND (time.setWarpIndex), never the legacy execute()", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-stream" }}>
          <WarpControlComponent id="warp-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("1×"));

    const button = screen.getByRole("button", { name: "10×" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
        index: 2,
      }),
    );
  });

  /**
   * Announcing tells this screen's own warp watcher the warp was meant, so it
   * does not trip its unscheduled-warp alarm. It is local only: a command centre
   * flagging a pilot's warp is wanted.
   */
  it("announces warp intent to its own screen before commanding a warp", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    fixture.transport.setCommandHandler(() => ({ ok: true }));
    const announce = vi.fn();

    render(
      <fixture.Provider>
        <WarpIntentProvider announce={announce}>
          <DashboardItemContext.Provider value={{ instanceId: "warp-intent" }}>
            <WarpControlComponent id="warp-intent" w={6} h={5} />
          </DashboardItemContext.Provider>
        </WarpIntentProvider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("1×"));

    act(() => {
      screen.getByRole("button", { name: "10×" }).click();
    });

    await waitFor(() => expect(announce).toHaveBeenCalled());
  });

  /** A station runs no warp watcher, so the widget must work with no announcer provider above it. */
  it("commands a warp with no announcer mounted at all", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-bare" }}>
          <WarpControlComponent id="warp-bare" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("1×"));

    act(() => {
      screen.getByRole("button", { name: "10×" }).click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
        index: 2,
      }),
    );
  });

  it("pause/unpause dispatch the absolute time.setPaused command", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp", "vessel.identity"],
      pinnedUt: 10,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-stream" }}>
          <WarpControlComponent id="warp-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("1×"));

    // Scene is unfed here, so the pause button does not render; the widget's own action sends the command instead.
    const { dispatchAction } = await import("@ksp-gonogo/core");
    await act(async () => {
      await dispatchAction("warp-stream", "togglePause", {
        kind: "button",
        value: true,
      });
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setPaused", {
        paused: true,
      }),
    );
  });
});
