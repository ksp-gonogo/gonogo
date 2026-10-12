import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

describe("WarpControl pause", () => {
  it("shows the game as running again when the pause was refused", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    fixture.transport.setCommandHandler((command) => {
      if (command === "time.setPaused") throw new Error("no path");
      return {};
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-pause" }}>
          <WarpControlComponent id="warp-pause" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "Pause game" }));

    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.some(
          (c) => c.command === "time.setPaused",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pause game" })).toBeTruthy(),
    );
  });
});
