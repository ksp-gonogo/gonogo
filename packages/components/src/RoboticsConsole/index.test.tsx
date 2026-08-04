import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { parseServos, RoboticsConsoleComponent } from "./index";

/**
 * RoboticsConsole runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`:
 * `parts.robotics` is its whole identity list and `robotics.available` its
 * DLC-presence flag (canonical stream reads, `useTelemetry`), and
 * `robotics.servo.*` command dispatch (delayed-command-ux robotics
 * migration) rides the same stream via `useCommand`, asserted against
 * `fixture.transport.sentCommands` rather than a legacy `MockDataSource`.
 */

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry: clearActionHandlers() firing on a still-mounted
// widget is a state update outside act(). RTL auto-cleanup runs after this
// file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const CARRIED = ["parts.robotics", "robotics.available"];

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
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rc" }}>
        <RoboticsConsoleComponent config={{}} id="rc" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("RoboticsConsoleComponent", () => {
  it("shows the DLC-absent state when robotics.available is false", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: false });
      fixture.emit("parts.robotics", []);
    });
    expect(
      await screen.findByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when available but the list is empty", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", []);
    });
    expect(
      await screen.findByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when nothing has arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderConsole(fixture);
    expect(
      await screen.findByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("renders current/target and fires setTarget when increasing", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
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
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        servo({
          partId: "12",
          type: "piston",
          currentExtension: 0.4,
          targetExtension: 0.6,
        }),
      ]);
    });
    expect(await screen.findByText(/MOVING/i)).toBeInTheDocument();
    // This test used to assert "60 %", which pinned a real bug: the contract
    // declares CurrentExtension/TargetExtension in METRES, and a decompile of
    // ModuleRoboticServoPiston confirms the value is a Vector3.Dot along the
    // servo axis. The old fixture numbers (40 and 60) were percentages, so the
    // test agreed with the widget and both were wrong together.
    // The number and its unit are separate text nodes in one element, so match
    // on the combined textContent and take the innermost hit.
    const withUnit = screen
      .getAllByText((_content, el) => el?.textContent === "0.60m")
      .at(-1);
    expect(withUnit).toBeDefined();
  });

  it("ignores rotor entries in the same parts.robotics array", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
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
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
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
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
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
    // Metre scale, and a metre-scale step. This asserted 0.65 from a target
    // of 0.6, which is a piston 0.6 METRES long being nudged 5 CENTIMETRES:
    // the percent reading the widget's label used to imply.
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
