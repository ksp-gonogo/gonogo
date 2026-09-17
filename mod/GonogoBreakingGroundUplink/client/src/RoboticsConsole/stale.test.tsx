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
 * What the Robotics Console does when `robotics.servos` stops arriving.
 *
 * It used to drop the whole list: `state === "observed" ? value : undefined`,
 * so a link that simply went quiet emptied the panel down to one sentence, and
 * the sentence was "Waiting for the robotic parts list", a never-arrived answer
 * about a list that had arrived and gone stale.
 *
 * What it does now is the split these assertions exist to pin. A joint's
 * identity, its lock and motor state, its torque limit and its commanded target
 * are all things a COMMAND set, and none of them drifts down a link that is not
 * delivering, so they are held. The MEASURED angle does drift, and this console
 * commands against it, so that one figure is withheld and the row says so.
 *
 * The assertion that earns this file is the one about what SURVIVES. A widget
 * that draws nothing passes almost every test ever written about it, so the
 * cases below check the roster is still on screen and still nameable.
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

/*
 * A SECOND joint, because the joint list only draws above one
 * (`showServoList = servos.length > 1`). With a single hinge the roster is not
 * on screen to survive anything, and the test that matters here is that the
 * roster survives.
 */
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
    // The control. Without it every assertion below would also pass on a
    // console that never drew an angle at all.
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

    /* Everything a command set is still on screen. This is the whole point:
       the operator can still see WHICH joints the craft has and what each was
       last asked to do. The roster used to vanish with the angle. */
    expect(visibleText(container)).toContain("Arm Hinge");
    expect(visibleText(container)).toContain("Bay Piston");
    expect(visibleText(container)).toContain("60°");

    // And the reason is named, with the half that is still good spelled out,
    // so a live panel does not read as a dead one.
    expect(visibleText(container)).toContain(
      "Measured positions no longer current",
    );
  });

  it("never calls a dated list a list that has not arrived", async () => {
    /* The absence lie this fix removes. `emptyStateText`'s waiting rung was
       reachable from a stale reading, so a dropped link answered "Waiting for
       the robotic parts list" about a list already received. */
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
