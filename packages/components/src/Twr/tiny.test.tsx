import { act, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

const STANDARD_GRAVITY = 9.80665;

function mountTiny(size = { w: 3, h: 3 }) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("twr", { ...size, wrapper: fixture.Provider });
  const emitTwr = (twr: number) =>
    act(() => {
      fixture.emit("vessel.propulsion", {
        totalMass: 1,
        dryMass: 0,
        currentThrust: twr * STANDARD_GRAVITY,
        availableThrust: twr * STANDARD_GRAVITY,
      });
    });
  return { ...mounted, fixture, emitTwr };
}

describe("Twr at the smallest tile", () => {
  it("draws the kit's arc with its figure in a 3x3 tile, and the framed dial from 4x4", async () => {
    const { unmount, fixture, emitTwr } = mountTiny();
    emitTwr(1.832);
    await waitFor(() => expect(visibleText()).toContain("1.83"));
    expect(document.querySelector('[aria-label^="TWR 1.83"]')).not.toBeNull();
    // The kit's tiny form draws the dial alone: no bar gauge and no trend strip.
    expect(document.querySelector("[data-tiny-essential]")).not.toBeNull();
    expect(document.querySelector("[data-tiny-gauge]")).toBeNull();
    unmount();

    renderWidget("twr", { w: 4, h: 4, wrapper: fixture.Provider });
    await waitFor(() => expect(visibleText()).toContain("1.83"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });

  it("says there is no engine data at the tiny size, with no arc, while the craft has none", async () => {
    mountTiny();
    await waitFor(() => expect(visibleText()).toContain("No engine"));
    expect(visibleText()).not.toContain(NULL_DISPLAY);
    expect(document.querySelector("[data-tiny-gauge]")).toBeNull();
    expect(document.querySelector("[aria-label^='TWR']")).toBeNull();
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container, emitTwr } = mountTiny();
    emitTwr(0.8);
    await waitFor(() => expect(visibleText()).toContain("0.80"));
    await expectNoA11yViolations(container);
  });
});
