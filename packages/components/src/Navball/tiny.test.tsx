import {
  clearActionHandlers,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
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

afterEach(() => {
  clearActionHandlers();
  // Each mount registers ~30 actions, so back-to-back mounts would trip the register/sec budget.
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

function mountTiny(size = { w: 3, h: 3 }) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const mounted = renderWidget("navball", {
    ...size,
    instanceId: "nb-tiny",
    wrapper: fixture.Provider,
  });
  const emitAttitude = (heading: number, pitch: number, roll: number) =>
    act(() => {
      fixture.emit("vessel.attitude", {
        heading,
        pitch,
        roll,
        headingRootFrame: heading,
        pitchRootFrame: pitch,
        rollRootFrame: roll,
      });
    });
  return { ...mounted, fixture, emitAttitude };
}

describe("Navball tiny mode", () => {
  it("draws heading, pitch and roll as figures with no title below four columns", async () => {
    const { container, emitAttitude } = mountTiny();
    emitAttitude(90, 45, -10);
    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    const [heading, pitch, roll] = essentialTexts();
    expect(heading).toMatch(/90/);
    expect(pitch).toMatch(/45/);
    expect(roll).toMatch(/10/);
    await expectNoA11yViolations(container);
  });

  it("draws the body's own figures from four columns", async () => {
    const { unmount, fixture } = mountTiny();
    unmount();
    renderWidget("navball", { w: 4, h: 3, wrapper: fixture.Provider });
    await waitFor(() =>
      expect(document.querySelectorAll("[data-attitude-line]")).toHaveLength(3),
    );
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
  });

  it("draws the null token for an angle that has not arrived", async () => {
    mountTiny();
    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    for (const text of essentialTexts()) expect(text).toContain(NULL_DISPLAY);
    await act(async () => {});
  });

  it("keeps its bound inputs live at the tiny size", async () => {
    const { fixture } = mountTiny();
    const handler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(handler);
    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    act(() => {
      fixture.emit("vessel.control", { sas: true, rcs: false, throttle: 0 });
    });
    act(() => {
      dispatchAction("nb-tiny", "toggle-sas", { kind: "button", value: true });
    });
    await waitFor(() => expect(handler).toHaveBeenCalled());
  });

  it("draws an armed fly-by-wire with a disarm control, which the tiny form would otherwise hide", async () => {
    const { fixture } = mountTiny();
    fixture.transport.setCommandHandler(() => ({ success: true }));
    act(() => {
      fixture.emit("vessel.comms", { controlState: 4 });
    });
    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    expect(
      screen.queryByRole("button", { name: "Disarm fly-by-wire" }),
    ).toBeNull();
    act(() => {
      dispatchAction("nb-tiny", "arm-fbw", { kind: "button", value: true });
    });
    const disarm = await screen.findByRole("button", {
      name: "Disarm fly-by-wire",
    });
    expect(disarm).toHaveTextContent("FBW ARMED");
  });
});
