import {
  act,
  clearActionHandlers,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: the widget self-registers on module load.
import "./index";

/**
 * When `robotics.servos` stops arriving every figure is held and the drawn positions carry the not-current mark; only the at-target verdict, a judgement about now, is withheld.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const HINGE = {
  partName: "Arm Hinge",
  partId: "11",
  type: "hinge",
  servoIsLocked: false,
  servoIsMotorized: true,
  servoMotorIsEngaged: true,
  servoMotorLimit: 100,
  currentAngle: 22,
  targetAngle: 60,
};

// A second joint, because the joint list only draws with more than one.
const PISTON = {
  partName: "Bay Piston",
  partId: "12",
  type: "piston",
  servoIsLocked: true,
  servoIsMotorized: true,
  servoMotorIsEngaged: false,
  servoMotorLimit: 50,
  currentExtension: 0.4,
  targetExtension: 0.9,
};

function mountWithHinge(instanceId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: ["robotics.servos", "robotics.available", "game.dlc"],
    pinnedUt: 10,
  });
  const rendered = renderWidget("robotics-console", {
    instanceId,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(rendered.unmount);
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true });
    fixture.emit("robotics.available", { available: true });
    fixture.emit("robotics.servos", [HINGE, PISTON]);
  });
  return { fixture, container: rendered.container };
}

describe("RoboticsConsole: a servo list that has stopped arriving", () => {
  it("draws the measured angle unmarked while the readings are current", async () => {
    // The control: without it the assertions below would pass on a console that never drew an angle.
    const { container } = mountWithHinge("rc-stale-control");

    await waitFor(() => expect(visibleText(container)).toContain("22°"));
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
    expect(visibleText(container)).toContain("MOVING");
  });

  it("holds the measured angle and marks it, with the joints, targets and settings", async () => {
    const { fixture, container } = mountWithHinge("rc-stale-held");
    await waitFor(() => expect(visibleText(container)).toContain("22°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(container.querySelector("[data-not-current-mark]")).not.toBeNull(),
    );
    expect(visibleText(container)).toContain("22°");
    expect(visibleText(container)).not.toContain("Position unknown");
    expect(visibleText(container)).not.toContain("no longer current");
    expect(visibleText(container)).toContain("Arm Hinge");
    expect(visibleText(container)).toContain("Bay Piston");
    expect(visibleText(container)).toContain("60°");
    // Whether the joint has reached its target is a claim about now.
    expect(visibleText(container)).not.toContain("MOVING");
  });

  it("never calls a dated list a list that has not arrived", async () => {
    const { fixture, container } = mountWithHinge("rc-stale-not-waiting");
    await waitFor(() => expect(visibleText(container)).toContain("22°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(container.querySelector("[data-not-current-mark]")).not.toBeNull(),
    );
    expect(visibleText(container)).not.toContain("Waiting for the");
    expect(visibleText(container)).not.toContain("No robotic parts");
  });
});
