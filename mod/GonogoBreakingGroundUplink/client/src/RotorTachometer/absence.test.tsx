import { dispatchAction } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "./index";

/**
 * What the Rotor Tachometer does with a figure the mod withheld.
 *
 * `BreakingGroundViewProvider` reads every rotor field through
 * `SnapshotDict.GetDouble`, which returns null for absent, non-numeric and
 * non-finite input alike, and `ServoCapture` nulls the fields that do not apply
 * to a rotor. This file is the client half: that null must reach the operator as
 * an absence, and must never reach the ROTOR as a commanded value.
 *
 * The `__fixtures__/rotors-dlc-absent.json` scene already states the principle
 * for the whole widget: "A dial parked at 0 RPM would read as a rotor that is
 * stopped, which is a reading".
 */

const CARRIED = ["robotics.servos", "robotics.available", "game.dlc"];

const INSTANCE = "rt-absence";

const rotor = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: "101",
  partName: "Main Rotor",
  type: "rotor",
  currentRPM: 240,
  rpmLimit: 300,
  servoMotorLimit: 80,
  maxTorque: 400,
  brakePercentage: 0,
  servoMotorIsEngaged: true,
  servoIsLocked: false,
  counterClockwise: false,
  normalizedOutput: 0.8,
  ...over,
});

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(entry: Record<string, unknown>) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  const result = renderWidget("rotor-tachometer", {
    instanceId: INSTANCE,
    config: {},
    w: 6,
    h: 10,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(result.unmount);
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    fixture.emit("robotics.available", { available: true });
    fixture.emit("robotics.servos", [entry]);
  });
  return { fixture, ...result };
}

describe("RotorTachometer: a withheld figure is not a zero", () => {
  it("draws no needle for an unread RPM, and says so instead", async () => {
    const { container } = mount(rotor({ currentRPM: null }));

    await waitFor(() =>
      expect(visibleText(container)).toContain("RPM unknown"),
    );
    // No dial, and no aria-label reporting "0 rpm" to a screen reader.
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.innerHTML).not.toContain("0 rpm");
  });

  it("says the RPM cap is unknown rather than reading it as 0", async () => {
    const { container } = mount(rotor({ rpmLimit: null }));

    await waitFor(() =>
      expect(visibleText(container)).toContain("RPM cap unknown"),
    );
    expect(visibleText(container)).not.toMatch(/RPM cap\s*0\b/);
  });

  it("says the torque and brake states are unknown rather than 0 and off", async () => {
    const { container } = mount(
      rotor({ servoMotorLimit: null, brakePercentage: null }),
    );

    await waitFor(() =>
      expect(visibleText(container)).toContain("Torque unknown"),
    );
    expect(visibleText(container)).toContain("Brake unknown");
    expect(visibleText(container)).not.toContain("Brake off");
  });

  it("reports an unknown figure in the rotor list rather than 0/0 RPM", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const result = renderWidget("rotor-tachometer", {
      instanceId: "rt-absence-list",
      config: {},
      w: 6,
      h: 10,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        rotor({ partId: "101", partName: "Main Rotor" }),
        rotor({
          partId: "202",
          partName: "Tail Rotor",
          currentRPM: null,
          rpmLimit: null,
        }),
      ]);
    });

    const row = await screen.findByRole("button", { name: /Tail Rotor/i });
    await waitFor(() =>
      expect(visibleText(row)).toContain("unknown/unknown RPM"),
    );
    expect(visibleText(row)).not.toContain("0/0 RPM");
  });
});

describe("RotorTachometer: an unread cap commands nothing", () => {
  it("disables both RPM stepper buttons and says why", async () => {
    mount(rotor({ rpmLimit: null }));

    const raise = await screen.findByRole("button", {
      name: /Raise RPM cap/i,
    });
    const lower = screen.getByRole("button", { name: /Lower RPM cap/i });
    expect(raise).toBeDisabled();
    expect(lower).toBeDisabled();
    // The reason is text, not just a greyed pixel.
    expect(raise.getAttribute("aria-label")).toContain("not reported");
    expect(lower.getAttribute("aria-label")).toContain("not reported");
  });

  it("dispatches no setRpmLimit when the + button is pressed", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(rotor({ rpmLimit: null }));

    /* The wait is on the BUTTON, not on the "unknown" readout, so this test
       reaches its dispatch assertion under the old coercion too and fails
       naming what went to the craft: `{ partId: "101", value: 10 }`, sent to a
       rotor really capped at 300 RPM. */
    await user.click(
      await screen.findByRole("button", { name: /Raise RPM cap/i }),
    );
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      ),
    ).toEqual([]);
  });

  it("dispatches no setRpmLimit from the mapped rpmUp action", async () => {
    const { fixture } = mount(rotor({ rpmLimit: null }));
    await screen.findByRole("button", { name: /Raise RPM cap/i });

    let returned: unknown;
    act(() => {
      returned = dispatchAction(INSTANCE, "rpmUp", {
        kind: "button",
        value: true,
      });
      dispatchAction(INSTANCE, "rpmDown", { kind: "button", value: true });
    });
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      ),
    ).toEqual([]);
    // And the handler returns nothing, so a bound device's render style shows
    // no cap either: the figure was computed, never measured.
    expect(returned).toBeUndefined();
  });

  it("dispatches no setBrake when the brake state was never read", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(rotor({ brakePercentage: null }));

    await user.click(await screen.findByRole("button", { name: /Brake/i }));
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.setBrake",
      ),
    ).toEqual([]);
  });

  it("still commands normally once the cap is a real reading", async () => {
    // The control, so the disabling above is not simply a dead stepper.
    const user = userEvent.setup();
    const { fixture } = mount(rotor({ rpmLimit: 300 }));

    await user.click(
      await screen.findByRole("button", { name: /Raise RPM cap/i }),
    );
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      );
      expect(sent?.args).toEqual({ partId: "101", value: 310 });
    });
  });

  it("has no a11y violations with every figure withheld", async () => {
    const { container } = mount(
      rotor({
        currentRPM: null,
        rpmLimit: null,
        servoMotorLimit: null,
        brakePercentage: null,
      }),
    );
    await screen.findByText(/RPM unknown/i);
    await expectNoA11yViolations(container);
  });
});

describe("RotorTachometer: an unread flag is not a false one", () => {
  it("prints no heading for a rotor whose direction was never read", async () => {
    const { container } = mount(rotor({ counterClockwise: null }));

    await waitFor(() => expect(visibleText(container)).toContain("Reverse"));
    // "↻ CW" is a definite claim, and it was what `=== true` produced.
    expect(visibleText(container)).not.toContain("CW");
    expect(visibleText(container)).not.toContain("CCW");
  });

  it("omits Direction from the reverse action rather than guessing it", async () => {
    // `reverse` carries no value, so the COMMAND still goes: it flips whatever
    // the rotor is doing. What must not happen is reporting "CW" back to the
    // device's render style off a flag nobody read.
    const { fixture } = mount(rotor({ counterClockwise: null }));
    await screen.findByRole("button", { name: /Reverse/i });

    let returned: unknown;
    act(() => {
      returned = dispatchAction(INSTANCE, "reverse", {
        kind: "button",
        value: true,
      });
    });
    await act(async () => {});

    expect(returned).toBeUndefined();
    // The command itself is unaffected.
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.reverse",
      ),
    ).toHaveLength(1);
  });

  it("still reports the heading when the flag is a real reading", async () => {
    mount(rotor({ counterClockwise: true }));
    await screen.findByRole("button", { name: /CCW/i });

    let returned: unknown;
    act(() => {
      returned = dispatchAction(INSTANCE, "reverse", {
        kind: "button",
        value: true,
      });
    });
    expect(returned).toEqual({ Direction: "CW" });
  });

  it("dispatches no setLock when the lock state was never read", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(rotor({ servoIsLocked: null }));

    await user.click(await screen.findByRole("button", { name: /Lock/i }));
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.setLock",
      ),
    ).toEqual([]);
  });

  it("dispatches no setMotor from the mapped toggleMotor action", async () => {
    const { fixture } = mount(rotor({ servoMotorIsEngaged: null }));
    await screen.findByRole("button", { name: /Motor/i });

    act(() => {
      dispatchAction(INSTANCE, "toggleMotor", { kind: "button", value: true });
    });
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.rotor.setMotor",
      ),
    ).toEqual([]);
  });

  it("leaves the off marker off a rotor row whose motor was unread", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const result = renderWidget("rotor-tachometer", {
      instanceId: "rt-absence-motor",
      config: {},
      w: 6,
      h: 10,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        rotor({ partId: "101", partName: "Main Rotor" }),
        rotor({
          partId: "202",
          partName: "Tail Rotor",
          servoMotorIsEngaged: null,
        }),
      ]);
    });

    const row = await screen.findByRole("button", { name: /Tail Rotor/i });
    await waitFor(() => expect(visibleText(row)).toContain("Tail Rotor"));
    // " · off" is what `r.motorEngaged ? "" : " · off"` printed for an unread
    // flag: the row said the motor was off.
    expect(visibleText(row)).not.toContain("off");
  });
});
