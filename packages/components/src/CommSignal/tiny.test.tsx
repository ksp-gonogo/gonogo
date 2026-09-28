import { act, screen, waitFor } from "@ksp-gonogo/test-utils";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

describe("CommSignal tiny mode", () => {
  it("draws the signal figure with the kit's level bars at 3x3, and the body from 3x4", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const { unmount } = renderWidget("comm-signal", {
      w: 3,
      h: 3,
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.62,
        controlState: 2,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("62 %"));
    expect(screen.getByRole("img", { name: "Signal 3 of 4" })).toBeTruthy();
    expect(document.querySelector("[data-level-bars]")).not.toBeNull();
    expect(document.querySelector("[data-tiny-essential]")).not.toBeNull();
    unmount();

    renderWidget("comm-signal", { w: 3, h: 4, wrapper: fixture.Provider });
    await waitFor(() => expect(visibleText()).toContain("62 %"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });
});
