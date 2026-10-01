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
  it("draws the worst band over the hottest part and engine below 4x5, and the body from 4x5", async () => {
    const { unmount, fixture, emitRatio } = mountTiny();
    emitRatio(0.5);
    await waitFor(() => expect(essentialTexts()[0]).toContain("NOMINAL"));
    const [heat, part, engine] = essentialTexts();
    expect(heat).toContain("Heat");
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

  it("cuts a long part name to fit its row and keeps the band word", async () => {
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
    await waitFor(() => expect(essentialTexts()[1]).toContain("Rockomax..."));
    expect(essentialTexts()[0]).toContain("NOMINAL");
    await act(async () => {});
  });

  it("says each band below critical politely and keeps the interrupting region silent", async () => {
    const { container, emitRatio } = mountTiny();
    for (const [ratio, word] of [
      [0.5, "NOMINAL"],
      [0.8, "WARM"],
      [0.93, "HOT"],
    ] as const) {
      emitRatio(ratio);
      await waitFor(() => expect(said("polite")).toBe(`Heat ${word}`));
      expect(said("assertive")).toBe("");
    }
    await expectNoA11yViolations(container);
  });

  it("interrupts to say CRITICAL, and says it nowhere politely", async () => {
    const { container, emitRatio } = mountTiny();
    emitRatio(0.93);
    await waitFor(() => expect(said("polite")).toBe("Heat HOT"));
    const assertive = document.querySelector("[aria-live=assertive]");

    emitRatio(0.98);
    await waitFor(() => expect(said("assertive")).toBe("Heat CRITICAL."));
    expect(said("polite")).toBe("");
    expect(document.querySelector("[aria-live=assertive]")).toBe(assertive);
    expect(essentialTexts()[0]).toContain("CRITICAL");
    await expectNoA11yViolations(container);
  });

  it("does not interrupt again while the record stays critical", async () => {
    const { emitRatio } = mountTiny();
    emitRatio(0.98);
    await waitFor(() => expect(said("assertive")).toBe("Heat CRITICAL."));
    const spoken = document.querySelector("[aria-live=assertive]")?.firstChild;
    expect(spoken).toBeTruthy();

    emitRatio(0.99);
    emitRatio(0.97, true);
    await waitFor(() => expect(essentialTexts()[1]).toMatch(/97\s%/));
    expect(document.querySelector("[aria-live=assertive]")?.firstChild).toBe(
      spoken,
    );
    await act(async () => {});
  });

  it("interrupts for an overheating engine however cool the hottest part reads", async () => {
    const { emitRatio } = mountTiny();
    emitRatio(0.4, true);
    await waitFor(() => expect(said("assertive")).toBe("Heat CRITICAL."));
    await act(async () => {});
  });

  it("draws the null token and says nothing while no record has arrived", async () => {
    mountTiny();
    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    for (const text of essentialTexts()) expect(text).toContain(NULL_DISPLAY);
    expect(said("polite")).toBe("");
    expect(said("assertive")).toBe("");
    await act(async () => {});
  });
});
