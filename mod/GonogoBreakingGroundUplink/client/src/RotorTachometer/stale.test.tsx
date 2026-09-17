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
 * What the Rotor Tachometer does when `robotics.servos` stops arriving.
 *
 * It used to drop the whole list, so a link that simply went quiet emptied the
 * panel down to "Waiting for the rotors list", a never-arrived answer about a
 * list that had arrived and gone stale.
 *
 * What it does now: the NEEDLE is withheld, because a rotor spins on without
 * telling us and the RPM is read as the situation right now. Everything else is
 * a setting (the cap the go-zone arc is drawn from, the torque and brake
 * figures, the motor, lock and direction states), and a setting does not drift
 * down a dead link, so all of it is held.
 *
 * The assertion that earns this file is the one about the CAP. Withholding it
 * would have blanked the scale around a needle already being withheld, which is
 * how the old collapse justified itself.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const ROTOR = {
  partName: "EM-32S Standard Rotor",
  partId: "13",
  type: "rotor",
  servoIsLocked: false,
  servoIsMotorized: true,
  servoMotorIsEngaged: true,
  servoMotorLimit: 75,
  currentRPM: 130,
  rpmLimit: 200,
};

function mountWithRotor(instanceId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: ["robotics.servos", "robotics.available", "game.dlc"],
    pinnedUt: 10,
  });
  const rendered = renderWidget("rotor-tachometer", {
    instanceId,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(rendered.unmount);
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true });
    fixture.emit("robotics.available", { available: true });
    fixture.emit("robotics.servos", [ROTOR]);
  });
  return { fixture, container: rendered.container };
}

describe("RotorTachometer: a rotor list that has stopped arriving", () => {
  it("drives the needle while the readings are current", async () => {
    // The control. Without it every assertion below would also pass on a
    // tachometer that never drew a needle at all.
    const { container } = mountWithRotor("rt-stale-control");

    await waitFor(() => expect(visibleText(container)).toContain("130"));
    expect(visibleText(container)).not.toContain("RPM unknown");
    expect(visibleText(container)).not.toContain("no longer current");
  });

  it("holds the rotor and its cap, and withholds only the RPM", async () => {
    const { fixture, container } = mountWithRotor("rt-stale-held");
    await waitFor(() => expect(visibleText(container)).toContain("130"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    /* The needle goes, and says it has gone rather than parking at zero: a
       dial at 0 is a rotor that is STOPPED, which is a reading an operator
       acts on. */
    await waitFor(() =>
      expect(visibleText(container)).toContain("RPM unknown"),
    );
    expect(visibleText(container)).not.toContain("130");

    // The cap survives. It is the figure the gauge's scale is built from, and
    // dropping it was how the old collapse took the whole instrument with it.
    expect(visibleText(container)).toContain("200");

    // And the reason names the half that is still good.
    expect(visibleText(container)).toContain("RPM no longer current");
  });

  it("never calls a dated list a list that has not arrived", async () => {
    const { fixture, container } = mountWithRotor("rt-stale-not-waiting");
    await waitFor(() => expect(visibleText(container)).toContain("130"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("RPM unknown"),
    );
    expect(visibleText(container)).not.toContain("Waiting for the");
    expect(visibleText(container)).not.toContain("No rotors");
  });
});
