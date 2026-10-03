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

function statusDot(): string | null {
  return (
    document
      .querySelector("[data-panel-status-dot]")
      ?.getAttribute("data-severity") ?? null
  );
}

function said(politeness: "polite" | "assertive"): string | null {
  const region = document.querySelector(`[aria-live=${politeness}]`);
  return region === null ? null : (region.textContent ?? "").trim();
}

function mountTiny() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("thermal-status", {
    w: 3,
    h: 5,
    wrapper: fixture.Provider,
  });
  const emitRatio = (ratio: number, anyEnginesOverheating = false) =>
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: { skinTemp: 1000, skinMaxTemp: 2000, name: "Nose Cone" },
        maxInternalTempRatio: ratio,
        hottestEngineTemp: 400,
        hottestEngineMaxTemp: 2000,
        hottestEngineTempRatio: 0.2,
        anyEnginesOverheating,
      });
    });
  return { ...mounted, fixture, emitRatio };
}

describe("ThermalStatus tiny mode", () => {
  it("draws the hottest part and engine below 4x5, and the body from 4x5", async () => {
    const { unmount, fixture, emitRatio } = mountTiny();
    emitRatio(0.5);
    await waitFor(() => expect(essentialTexts()).toHaveLength(2));
    const [part, engine] = essentialTexts();
    expect(part).toContain("Nose Cone");
    expect(part).toMatch(/50\s%/);
    expect(engine).toContain("Engine");
    expect(engine).toMatch(/20\s%/);
    unmount();

    renderWidget("thermal-status", { w: 4, h: 5, wrapper: fixture.Provider });
    await waitFor(() => expect(visibleText()).toContain("Nose Cone"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });

  it("cuts a long part name to fit its row", async () => {
    const { fixture } = mountTiny();
    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: {
          skinTemp: 1000,
          skinMaxTemp: 2000,
          name: "Rockomax Jumbo-64 Fuel Tank",
        },
        maxInternalTempRatio: 0.5,
        hottestEngineTemp: 400,
        hottestEngineMaxTemp: 2000,
        hottestEngineTempRatio: 0.2,
        anyEnginesOverheating: false,
      });
    });
    await waitFor(() => expect(essentialTexts()[0]).toContain("Rockomax..."));
    await act(async () => {});
  });

  it("carries the worst band as the header dot, never as a word in the tile", async () => {
    const { container, emitRatio } = mountTiny();
    for (const [ratio, severity] of [
      [0.5, "go"],
      [0.8, "warn"],
      [0.93, "warn"],
      [0.98, "nogo"],
    ] as const) {
      emitRatio(ratio);
      await waitFor(() => expect(statusDot()).toBe(severity));
      for (const text of essentialTexts()) {
        expect(text).not.toMatch(/NOMINAL|WARM|HOT|CRITICAL|HEAT/i);
      }
    }
    await expectNoA11yViolations(container);
  });

  it("interrupts to say CRITICAL once, and says it nowhere politely", async () => {
    const { emitRatio } = mountTiny();
    emitRatio(0.93);
    await waitFor(() => expect(statusDot()).toBe("warn"));
    expect(said("assertive")).toBe("");

    emitRatio(0.98);
    await waitFor(() => expect(said("assertive")).toBe("THERMAL: critical"));
    expect(said("polite")).toBe("");
    await act(async () => {});
  });

  it("interrupts for an overheating engine however cool the hottest part reads", async () => {
    const { emitRatio } = mountTiny();
    emitRatio(0.4);
    await waitFor(() => expect(statusDot()).toBe("go"));
    emitRatio(0.4, true);
    await waitFor(() => expect(said("assertive")).toBe("THERMAL: critical"));
    await act(async () => {});
  });

  it("draws the null token and no status dot while no record has arrived", async () => {
    mountTiny();
    await waitFor(() => expect(essentialTexts()).toHaveLength(2));
    for (const text of essentialTexts()) expect(text).toContain(NULL_DISPLAY);
    expect(statusDot()).toBeNull();
    await act(async () => {});
  });
});
