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
 * Proves that when `robotics.servos` stops arriving the measured angle is withheld and named, while the roster and everything a command set stays on screen.
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
  it("draws the measured angle while the readings are current", async () => {
    // The control: without it the assertions below would pass on a console that never drew an angle.
    const { container } = mountWithHinge("rc-stale-control");

    await waitFor(() => expect(visibleText(container)).toContain("22°"));
    expect(visibleText(container)).not.toContain("Position unknown");
    expect(visibleText(container)).not.toContain("no longer current");
  });

  it("holds the joint, its target and its settings, and withholds only the measured angle", async () => {
    const { fixture, container } = mountWithHinge("rc-stale-held");
    await waitFor(() => expect(visibleText(container)).toContain("22°"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    // The measured angle goes, and says it has gone rather than blanking.
    await waitFor(() =>
      expect(visibleText(container)).toContain("Position unknown"),
    );
    expect(visibleText(container)).not.toContain("22°");

    // Everything a command set is still on screen.
    expect(visibleText(container)).toContain("Arm Hinge");
    expect(visibleText(container)).toContain("Bay Piston");
    expect(visibleText(container)).toContain("60°");

    // The reason is named, so a held panel does not read as a dead one.
    expect(visibleText(container)).toContain(
      "Measured positions no longer current",
    );
  });

  it("never calls a dated list a list that has not arrived", async () => {
    const { fixture, container } = mountWithHinge("rc-stale-not-waiting");
    await waitFor(() => expect(visibleText(container)).toContain("22°"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Position unknown"),
    );
    expect(visibleText(container)).not.toContain("Waiting for the");
    expect(visibleText(container)).not.toContain("No robotic parts");
  });
});
