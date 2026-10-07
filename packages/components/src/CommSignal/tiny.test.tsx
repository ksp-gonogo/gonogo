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

  it("carries the same mark as the body: none for the believed path's measured worth, the triangle for a worked-out one, the ring for another path's", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("comm-signal", { w: 3, h: 3, wrapper: fixture.Provider });
    const mark = () => document.querySelector("[data-held-mark]");
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.signal", { strength: 0.6, modelled: false });
    });
    await waitFor(() => expect(visibleText()).toContain("60 %"));
    expect(mark()).toBeNull();

    act(() => {
      fixture.emit("comms.signal", { strength: 0.6, modelled: true });
    });
    await waitFor(() =>
      expect(mark()?.getAttribute("data-reckoning-mark")).toBe("modelled"),
    );
    expect(document.body.textContent).toMatch(/worked out for the path/i);

    act(() => {
      fixture.emit("comms.signal", {
        strength: 0.6,
        modelled: false,
        otherPath: true,
      });
    });
    await waitFor(() =>
      expect(mark()?.getAttribute("data-reckoning-mark")).toBe("current"),
    );
    expect(mark()?.hasAttribute("data-elsewhere")).toBe(true);
    expect(document.body.textContent).toMatch(/measured on another path/i);
    await act(async () => {});
  });

  it("says AWAIT, never LOS or a zero, before the link's first word has arrived", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("comm-signal", { w: 3, h: 3, wrapper: fixture.Provider });

    await waitFor(() => expect(visibleText()).toContain("AWAIT"));
    expect(visibleText()).not.toContain("LOS");
    expect(screen.queryByRole("img", { name: "Signal 0 of 4" })).toBeNull();
    await act(async () => {});
  });

  it("says LOS beside the bars when the link is lost, and announces it politely", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWidget("comm-signal", { w: 3, h: 3, wrapper: fixture.Provider });
    act(() => {
      fixture.emit("comms.link", { connected: false });
      fixture.emit("vessel.comms", {
        connected: false,
        signalStrength: 0,
        controlState: 0,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("LOS"));
    expect(screen.getByRole("img", { name: "Signal 0 of 4" })).toBeTruthy();
    const spoken = [...document.querySelectorAll("[aria-live=polite]")].map(
      (r) => r.textContent,
    );
    expect(spoken).toContain("Signal LOS");
    expect(document.querySelector("[aria-live=assertive]")).toBeNull();
    await act(async () => {});
  });
});
