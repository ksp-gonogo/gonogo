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
import { parseServos } from "./index";
import "./index";

/**
 * What the Robotics Console does with a position the mod withheld.
 *
 * `BreakingGroundViewProvider` reads every servo field through
 * `SnapshotDict.GetDouble` (null for absent, non-numeric and non-finite alike)
 * and `ServoCapture` nulls the fields that do not apply to a joint of the kind
 * in hand, so a hinge carries no extension and a piston no angle. This file is
 * the client half: the withheld position must not become a zero, the AT TARGET
 * verdict must not be derived from two of them, and the target stepper must not
 * command from one.
 */

const CARRIED = ["robotics.servos", "robotics.available", "game.dlc"];

const INSTANCE = "rc-absence";

const servo = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: "11",
  partName: "Arm Hinge",
  type: "hinge",
  currentAngle: 22,
  targetAngle: 60,
  servoMotorIsEngaged: true,
  servoIsLocked: false,
  servoMotorLimit: 100,
  ...over,
});

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(entry: Record<string, unknown>, instanceId = INSTANCE) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  const result = renderWidget("robotics-console", {
    instanceId,
    config: {},
    w: 5,
    h: 8,
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

describe("parseServos: a withheld position is not a zero", () => {
  it("withholds current, target and the atTarget verdict together", () => {
    const [joint] = parseServos([{ partId: "11", type: "hinge" }]);
    expect(joint?.current).toBeNull();
    expect(joint?.target).toBeNull();
    // Derived from the two above, so there is nothing to derive it from. This
    // read `true` off `abs(0 - 0) < 0.5`: an AT TARGET badge for a joint whose
    // position nobody measured.
    expect(joint?.atTarget).toBeNull();
    expect(joint?.torqueLimit).toBeNull();
  });

  it("withholds a piston's extension when only the angle fields arrived", () => {
    // `ServoCapture` nulls what does not apply to the kind, so a piston
    // carries no angle and the extension fields are the ones to read.
    const [piston] = parseServos([
      { partId: "12", type: "piston", currentAngle: 30, targetAngle: 30 },
    ]);
    expect(piston?.current).toBeNull();
    expect(piston?.target).toBeNull();
    expect(piston?.atTarget).toBeNull();
  });

  it("keeps deriving atTarget when both sides are real readings", () => {
    const [joint] = parseServos([
      { partId: "11", type: "hinge", currentAngle: 30, targetAngle: 30.2 },
    ]);
    expect(joint?.atTarget).toBe(true);
  });
});

describe("RoboticsConsole: a withheld position is withheld on screen", () => {
  it("says the position is unknown rather than drawing it at 0", async () => {
    const { container } = mount(servo({ currentAngle: null }));

    await waitFor(() =>
      expect(visibleText(container)).toContain("Position unknown"),
    );
    expect(visibleText(container)).not.toMatch(/^ROBOTICS0°/);
  });

  it("says the target is unknown rather than drawing it at 0", async () => {
    const { container } = mount(servo({ targetAngle: null }));

    await waitFor(() =>
      expect(visibleText(container)).toContain("Target unknown"),
    );
  });

  it("shows neither AT TARGET nor MOVING with nothing to derive one from", async () => {
    mount(servo({ currentAngle: null, targetAngle: null }));

    await screen.findByText(/Position unknown/i);
    // AT TARGET is the one the old code produced, off `abs(0 - 0) < 0.5`.
    expect(screen.queryByText(/AT TARGET/i)).toBeNull();
    expect(screen.queryByText(/MOVING/i)).toBeNull();
  });

  it("reports an unknown position in the joint list rather than 0°/0°", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const result = renderWidget("robotics-console", {
      instanceId: "rc-absence-list",
      config: {},
      w: 5,
      h: 8,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({ partId: "11", partName: "Arm Hinge" }),
        servo({
          partId: "22",
          partName: "Wrist Hinge",
          currentAngle: null,
          targetAngle: null,
        }),
      ]);
    });

    const row = await screen.findByRole("button", { name: /Wrist Hinge/i });
    await waitFor(() => expect(visibleText(row)).toContain("unknown/unknown"));
    expect(visibleText(row)).not.toContain("0°/0°");
    // And no tick, which is the list's own spelling of AT TARGET.
    expect(visibleText(row)).not.toContain("✓");
  });

  it("has no a11y violations with the position withheld", async () => {
    const { container } = mount(
      servo({ currentAngle: null, targetAngle: null, servoMotorLimit: null }),
    );
    await screen.findByText(/Position unknown/i);
    await expectNoA11yViolations(container);
  });
});

describe("RoboticsConsole: an unread target commands nothing", () => {
  it("disables both target stepper buttons and says why", async () => {
    mount(servo({ targetAngle: null }));

    const raise = await screen.findByRole("button", {
      name: /Increase target/i,
    });
    const lower = screen.getByRole("button", { name: /Decrease target/i });
    expect(raise).toBeDisabled();
    expect(lower).toBeDisabled();
    expect(raise.getAttribute("aria-label")).toContain("not reported");
    expect(lower.getAttribute("aria-label")).toContain("not reported");
  });

  it("dispatches no setTarget when the + button is pressed", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(servo({ targetAngle: null }));

    /* The wait is on the BUTTON, not on the "unknown" readout, so this test
       reaches its dispatch assertion under the old coercion too and fails
       naming what went to the craft: `{ partId: "11", value: 5 }`, sent to a
       hinge whose real target was 60°. */
    await user.click(
      await screen.findByRole("button", { name: /Increase target/i }),
    );
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.servo.setTarget",
      ),
    ).toEqual([]);
  });

  it("dispatches no setTarget from the mapped targetUp action", async () => {
    const { fixture } = mount(servo({ targetAngle: null }));
    await screen.findByRole("button", { name: /Increase target/i });

    let returned: unknown;
    act(() => {
      returned = dispatchAction(INSTANCE, "targetUp", {
        kind: "button",
        value: true,
      });
      dispatchAction(INSTANCE, "targetDown", { kind: "button", value: true });
    });
    await act(async () => {});

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "robotics.servo.setTarget",
      ),
    ).toEqual([]);
    expect(returned).toBeUndefined();
  });

  it("still commands normally once the target is a real reading", async () => {
    // The control, so the disabling above is not simply a dead stepper.
    const user = userEvent.setup();
    const { fixture } = mount(servo({ targetAngle: 60 }));

    await user.click(
      await screen.findByRole("button", { name: /Increase target/i }),
    );
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.servo.setTarget",
      );
      expect(sent?.args).toEqual({ partId: "11", value: 65 });
    });
  });
});
