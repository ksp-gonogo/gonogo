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

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

function mountTiny(size = { w: 3, h: 3 }) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("semi-major-axis", {
    ...size,
    wrapper: fixture.Provider,
  });
  const emitOrbit = (sma: number) =>
    act(() => {
      fixture.emit("vessel.orbit", { sma, referenceBodyIndex: 1 });
    });
  return { ...mounted, fixture, emitOrbit };
}

describe("SemiMajorAxis tiny mode", () => {
  it("draws the figure with its unit and no title below 4x4, and the body from 4x4", async () => {
    const { unmount, fixture, emitOrbit } = mountTiny();
    emitOrbit(675_000);
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    expect(essentialTexts()[0]).toMatch(/675\.0\skm/);
    expect(visibleText()).not.toContain("Semi-major axis");
    expect(document.querySelector("svg[aria-label='SMA trend']")).toBeNull();
    unmount();

    renderWidget("semi-major-axis", {
      w: 4,
      h: 4,
      wrapper: fixture.Provider,
    });
    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });

  it("draws the tiny form on a tile that is short or narrow on one axis alone", async () => {
    const { emitOrbit } = mountTiny({ w: 3, h: 4 });
    emitOrbit(675_000);
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    await act(async () => {});
  });

  it("says a hyperbolic orbit in a row of its own, where the figure is negative", async () => {
    const { emitOrbit } = mountTiny({ w: 3, h: 4 });
    emitOrbit(-2_500_000);
    await waitFor(() =>
      expect(document.body.textContent).toContain("HYPERBOLIC"),
    );
    await act(async () => {});
  });

  it("draws the null token while no orbit has arrived", async () => {
    mountTiny();
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    expect(essentialTexts()[0]).toContain(NULL_DISPLAY);
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container, emitOrbit } = mountTiny();
    emitOrbit(675_000);
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    await expectNoA11yViolations(container);
  });
});
