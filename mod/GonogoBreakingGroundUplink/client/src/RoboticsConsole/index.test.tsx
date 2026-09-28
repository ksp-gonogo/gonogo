import {
  act,
  clearActionHandlers,
  render as rtlRender,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { parseServos } from "./index";

/** Proves RoboticsConsole reads and commands over the real stream pipeline via `StubTransport`, asserted against `sentCommands`. */

// Unmounted in afterEach before the action-handler registry is cleared, since RTL's own cleanup runs too late.
const renderedTrees: Array<() => void> = [];

function _render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const servo = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: "11",
  partName: "Hinge A",
  type: "hinge",
  currentAngle: 30,
  targetAngle: 30,
  servoMotorIsEngaged: true,
  servoIsLocked: false,
  servoMotorLimit: 100,
  ...over,
});

function renderConsole(fixture: ReturnType<typeof setupStreamFixture>) {
  return renderWidget("robotics-console", {
    instanceId: "rc",
    config: {},
    wrapper: fixture.Provider,
  });
}

describe("RoboticsConsoleComponent", () => {
  /** The DLC sentence comes off `game.dlc.breakingGround`; `robotics.available: false` means the craft carries no robotic part. */
  it("names the missing DLC off game.dlc, not off robotics.available", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: false, makingHistory: true });
      fixture.emit("robotics.servos", []);
    });
    expect(
      await screen.findByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when the craft carries no robotic part", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true, makingHistory: true });
      fixture.emit("robotics.available", { available: false });
    });
    expect(
      await screen.findByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when available but the list is empty", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", []);
    });
    expect(
      await screen.findByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("says it is waiting when neither presence fact has arrived", async () => {
    // Nothing reported yet is waiting, not a craft with no robotic parts.
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    expect(
      await screen.findByText(/Waiting for the robotic parts list/i),
    ).toBeInTheDocument();
  });

  it("renders current/target and fires setTarget when increasing", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({ partId: "11", currentAngle: 30, targetAngle: 30 }),
      ]);
    });

    expect(await screen.findByText(/AT TARGET/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.servo.setTarget",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "11", value: 35 });
    });
  });

  it("labels a piston in metres, not percent", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({
          partId: "12",
          type: "piston",
          currentExtension: 0.4,
          targetExtension: 0.6,
        }),
      ]);
    });
    expect(await screen.findByText(/MOVING/i)).toBeInTheDocument();
    // Piston extension is in metres. The number and unit are separate text nodes, so match the innermost combined textContent.
    const withUnit = screen
      .getAllByText((_content, el) => el?.textContent === "0.60m")
      .at(-1);
    expect(withUnit).toBeDefined();
  });

  it("ignores rotor entries in the same robotics.servos array", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({ partId: "11" }),
        { partId: "99", partName: "Main Rotor", type: "rotor" },
      ]);
    });
    await screen.findByText(/AT TARGET/i);
    expect(
      screen.queryByRole("button", { name: /Main Rotor/i }),
    ).not.toBeInTheDocument();
  });

  it("toggles the motor with the inverse of current state", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({ partId: "11", servoMotorIsEngaged: true }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Motor on/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.servo.setMotor",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "11", enabled: false });
    });
  });

  it("selects a joint from the list and targets it", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        servo({ partId: "11", partName: "Hinge A", targetAngle: 30 }),
        servo({
          partId: "22",
          partName: "Piston B",
          type: "piston",
          targetExtension: 0.6,
        }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Piston B/i }));
    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    // A metre-scale step on a metre-scale target.
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.servo.setTarget",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "22", value: 0.65 });
    });
  });
});

describe("parseServos", () => {
  it("returns an empty list for absent or non-array input", () => {
    expect(parseServos(undefined)).toEqual([]);
    expect(parseServos(null)).toEqual([]);
    expect(parseServos({})).toEqual([]);
  });

  it("drops entries with no string partId or an unrecognized type", () => {
    const parsed = parseServos([
      { partId: "5", type: "hinge", currentAngle: 10 },
      { type: "piston" },
      { partId: 6, type: "hinge" },
      { partId: "7", type: "rotor" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe("hinge");
    expect(parsed[0]?.current).toBe(10);
  });

  it("lists a rotation servo alongside the hinges, in degrees", () => {
    const parsed = parseServos([
      { partId: "5", partName: "Hinge A", type: "hinge", currentAngle: 10 },
      {
        partId: "6",
        partName: "Rotation Servo M-06",
        type: "rotationServo",
        currentAngle: 135,
        targetAngle: 180,
      },
    ]);
    const rotation = parsed.find((s) => s.type === "rotationServo");
    expect(parsed).toHaveLength(2);
    expect(rotation?.name).toBe("Rotation Servo M-06");
    expect(rotation?.current).toBe(135);
    expect(rotation?.target).toBe(180);
    expect(rotation?.atTarget).toBe(false);
  });

  it("derives atTarget from current/target proximity", () => {
    const [atTarget, moving] = parseServos([
      {
        partId: "1",
        type: "hinge",
        currentAngle: 30,
        targetAngle: 30.2,
      },
      {
        partId: "2",
        type: "hinge",
        currentAngle: 10,
        targetAngle: 30,
      },
    ]);
    expect(atTarget?.atTarget).toBe(true);
    expect(moving?.atTarget).toBe(false);
  });
});
