import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: the widget self-registers on module load.
import "./index";

/**
 * What the Rotor Tachometer does when `robotics.servos` stops arriving: every
 * figure is held, and the gauge marks the held rpm rather than blanking it.
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
    // The control: without it the assertions below would pass on a tachometer that never drew a needle.
    const { container } = mountWithRotor("rt-stale-control");

    await waitFor(() => expect(visibleText(container)).toContain("130"));
    expect(screen.getByRole("meter", { name: /EM-32S/ })).not.toHaveAttribute(
      "data-held",
    );
  });

  it("holds the rpm on the gauge and marks it, with the cap", async () => {
    const { fixture, container } = mountWithRotor("rt-stale-held");
    await waitFor(() => expect(visibleText(container)).toContain("130"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    const gauge = await screen.findByRole("meter", { name: /EM-32S/ });
    await waitFor(() => expect(gauge).toHaveAttribute("data-held"));
    expect(gauge).toHaveAccessibleName(
      /^EM-32S Standard Rotor: 130 rpm, cap 200 rpm, \S/,
    );
    expect(visibleText(container)).toContain("130");
    expect(visibleText(container)).toContain("200");
    expect(visibleText(container)).not.toContain("RPM unknown");
  });

  it("never calls a dated list a list that has not arrived", async () => {
    const { fixture, container } = mountWithRotor("rt-stale-not-waiting");
    await waitFor(() => expect(visibleText(container)).toContain("130"));

    act(() => {
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(screen.getByRole("meter", { name: /EM-32S/ })).toHaveAttribute(
        "data-held",
      ),
    );
    expect(visibleText(container)).not.toContain("Waiting for the");
    expect(visibleText(container)).not.toContain("No rotors");
  });
});
