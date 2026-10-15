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

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

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

describe("Twr tiny mode", () => {
  it("draws the ratio as a figure over a gauge below 4x4, and the dial from 4x4", async () => {
    const { unmount, fixture, emitTwr } = mountTiny();
    emitTwr(1.832);
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    expect(essentialTexts()[0]).toContain("1.83");
    expect(document.querySelector("[data-tiny-gauge]")).not.toBeNull();
    unmount();

    renderWidget("twr", { w: 4, h: 4, wrapper: fixture.Provider });
    await waitFor(() => expect(visibleText()).toContain("1.83"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });

  it("draws the null token while the craft has no engine data", async () => {
    mountTiny();
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    expect(essentialTexts()[0]).toContain(NULL_DISPLAY);
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container, emitTwr } = mountTiny();
    emitTwr(0.8);
    await waitFor(() => expect(essentialTexts()[0]).toContain("0.80"));
    await expectNoA11yViolations(container);
  });
});
