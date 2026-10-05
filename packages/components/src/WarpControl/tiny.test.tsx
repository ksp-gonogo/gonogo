import { clearActionHandlers, dispatchAction } from "@ksp-gonogo/core";
import { act, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  renderWidget,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

describe("WarpControl tiny mode", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  function setup(warpRateIndex: number, warpRate: number) {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const result = renderWidget("warp-control", {
      w: 3,
      h: 3,
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("time.warp", {
        warpRate,
        warpRateIndex,
        warpMode: 0,
        paused: false,
      });
    });
    return { fixture, ...result };
  }

  it("draws the warp level and the one button that drops it to realtime", async () => {
    const { container } = setup(5, 1000);
    const button = await screen.findByRole("button", {
      name: "Reset time warp to 1×",
    });
    expect(button).toHaveTextContent("1×");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await waitFor(() => expect(document.body.textContent).toContain("1.0k×"));
    await expectNoA11yViolations(container);
  });

  it("sends the same command a ladder press does", async () => {
    const user = userEvent.setup();
    const { fixture } = setup(5, 1000);
    await user.click(
      await screen.findByRole("button", { name: "Reset time warp to 1×" }),
    );
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "time.setWarpIndex",
      );
      expect(sent?.args).toEqual({ index: 0 });
    });
  });

  it("holds the button while the game is already at realtime", async () => {
    setup(0, 1);
    const button = await screen.findByRole("button", {
      name: "Reset time warp to 1×",
    });
    expect(button).toBeDisabled();
  });

  it("keeps its serial and keyboard binding while the body is unmounted", async () => {
    const { fixture } = setup(5, 1000);
    await screen.findByRole("button", { name: "Reset time warp to 1×" });
    act(() => {
      dispatchAction("warp-control-test", "stop", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.some(
          (c) => c.command === "time.setWarpIndex",
        ),
      ).toBe(true),
    );
    await act(async () => {});
  });
});
