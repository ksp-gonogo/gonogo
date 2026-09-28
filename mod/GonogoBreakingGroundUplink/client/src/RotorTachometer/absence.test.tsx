import { dispatchAction } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "./index";

/** Proves a withheld rotor figure reaches the operator as an absence and never reaches the rotor as a commanded value. */

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
  it("draws no needle for an unread RPM, and the null token instead", async () => {
    const { container } = mount(rotor({ currentRPM: null }));

    const gauge = await screen.findByRole("img", { name: /RPM unknown/ });
    // No needle, and no aria-label reporting "0 rpm" to a screen reader.
    expect(gauge.querySelector("line")).toBeNull();
    expect(gauge.textContent).toContain(NULL_DISPLAY);
    expect(container.innerHTML).not.toMatch(/\b0 rpm/);
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
      expect(visibleText(row)).toContain(`${NULL_DISPLAY}/${NULL_DISPLAY}`),
    );
    // Matched without the unit, so a withheld figure coming back as zero cannot pass on a case mismatch.
    expect(visibleText(row)).not.toContain("0/0");
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
    expect(raise.getAttribute("aria-label")).toContain("not reported");
    expect(lower.getAttribute("aria-label")).toContain("not reported");
  });

  it("dispatches no setRpmLimit when the + button is pressed", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(rotor({ rpmLimit: null }));

    // Waits on the button, not the readout, so a regression fails naming what was sent to the craft.
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
    // A bound device's render style shows no cap either.
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
    await screen.findByRole("img", { name: /RPM unknown/ });
    await expectNoA11yViolations(container);
  });
});

describe("RotorTachometer: an unread flag is not a false one", () => {
  it("prints no heading for a rotor whose direction was never read", async () => {
    const { container } = mount(rotor({ counterClockwise: null }));

    await waitFor(() => expect(visibleText(container)).toContain("Reverse"));
    expect(visibleText(container)).not.toContain("CW");
    expect(visibleText(container)).not.toContain("CCW");
  });

  it("omits Direction from the reverse action rather than guessing it", async () => {
    // Reverse carries no value, so the command still goes; only the reported heading is withheld.
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
    await act(async () => {});

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
    // An unread motor flag is not "off".
    expect(visibleText(row)).not.toContain("off");
  });
});
