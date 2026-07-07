import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/**
 * The M3 pilot's stream test-adapter proof (`m3-migration-plan.md`
 * §4-test): `WarpControl` genuinely running off the stream — a real
 * `TelemetryProvider` + `TelemetryClient`/`TimelineStore` pipeline fed via
 * `StubTransport` — never the legacy `MockDataSource` registry (none is even
 * registered in this file). Green here means "works off streams", not
 * "green off the legacy fallback while the mapped read silently never
 * fires" (`m3-migration-plan.md` §5.4's "test-green-but-semantically-
 * drifted" risk this adapter exists to close).
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("WarpControl — genuinely runs off the stream (M3 pilot)", () => {
  it("reads the recorded time.warp state off the real stream pipeline, not legacy", async () => {
    // No legacy "data" DataSource registered anywhere in this file — if the
    // widget's reads were still secretly falling back to legacy, there
    // would be nothing to fall back TO and the rate readout would stay "—"
    // forever, not resolve to "10×".
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-stream" }}>
          <WarpControlComponent id="warp-stream" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — the rate readout is the loading placeholder.
    expect(screen.getByText("—")).toBeTruthy();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
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
    // t.warpMode -> time.warp.warpMode, WarpMode enum 0 = High.
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("a warp-ladder click dispatches a COMMAND (time.setWarpIndex), never the legacy execute()", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["time.warp", "time.setWarpIndex"],
      pinnedUt: 10,
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
    await waitFor(() => expect(screen.getByText("1×")).toBeTruthy());

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

  it("pause/unpause dispatch the absolute time.setPaused command", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "time.warp",
        "time.setWarpIndex",
        "time.setPaused",
        "vessel.identity",
      ],
      pinnedUt: 10,
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
    await waitFor(() => expect(screen.getByText("1×")).toBeTruthy());

    // The pause toggle button only renders in the "Flight" scene
    // (`useGameContext`'s `kc.scene`, unmapped/legacy-only) — no legacy
    // source is registered in this stream-only test, so `scene` reads
    // "Unknown" and the pause button doesn't render. Fire the command
    // directly via the widget's own action instead (still exercises the
    // exact same `useExecuteAction` command-shim path a real serial-input
    // mapping would).
    const { dispatchAction } = await import("@gonogo/core");
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
