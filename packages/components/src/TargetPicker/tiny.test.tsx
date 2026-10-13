import {
  clearActionHandlers,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  renderWidget,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

beforeEach(() => {
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => clearActionHandlers());

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

function mountTiny() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("target-picker", {
    w: 3,
    h: 3,
    instanceId: "tp-tiny",
    wrapper: fixture.Provider,
  });
  return { ...mounted, fixture };
}

describe("TargetPicker tiny mode", () => {
  it("draws the target's name over its range, and says none when nothing is targeted", async () => {
    const { container, fixture } = mountTiny();
    await waitFor(() => expect(essentialTexts()[0]).toContain("NONE"));

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
        relativeVelocity: { x: -2.5, y: 0, z: 0 },
      });
    });
    await waitFor(() => expect(essentialTexts()[0]).toContain("Test Station"));
    expect(essentialTexts()[0]).toMatch(/1\.5\skm/);
    await expectNoA11yViolations(container);
  });

  it("keeps the clear-target input live at the tiny size", async () => {
    const { fixture } = mountTiny();
    const handler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(handler);
    await waitFor(() => expect(essentialTexts()).toHaveLength(1));
    act(() => {
      dispatchAction("tp-tiny", "clear-target", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() => expect(handler).toHaveBeenCalled());
  });

  it("draws the body from four columns", async () => {
    const { unmount, fixture } = mountTiny();
    unmount();
    renderWidget("target-picker", { w: 4, h: 3, wrapper: fixture.Provider });
    await waitFor(() =>
      expect(document.body.textContent).toContain("No target set"),
    );
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });
});
