import {
  DashboardItemContext,
  type DataKey,
  type MockDataSource,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { parseServos, RoboticsConsoleComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "parts.robotics" },
  { key: "robotics.available" },
];

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

function renderConsole() {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "rc" }}>
      <RoboticsConsoleComponent config={{}} id="rc" />
    </DashboardItemContext.Provider>,
  );
}

describe("RoboticsConsoleComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the DLC-absent state when robotics.available is false", () => {
    renderConsole();
    act(() => {
      source.emit("robotics.available", false);
      source.emit("parts.robotics", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when available but the list is empty", () => {
    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", []);
    });
    expect(
      screen.getByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when the key is absent", () => {
    renderConsole();
    expect(
      screen.getByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("renders current/target and fires setTarget when increasing", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        servo({ partId: "11", currentAngle: 30, targetAngle: 30 }),
      ]);
    });

    expect(screen.getByText(/AT TARGET/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setTarget[11,35]");
  });

  it("uses % units for pistons", () => {
    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        servo({
          partId: "12",
          type: "piston",
          currentExtension: 40,
          targetExtension: 60,
        }),
      ]);
    });
    expect(screen.getByText(/MOVING/i)).toBeInTheDocument();
    // Stepper value shows the piston target with a % unit.
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("ignores rotor entries in the same parts.robotics array", () => {
    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        servo({ partId: "11" }),
        { partId: "99", partName: "Main Rotor", type: "rotor" },
      ]);
    });
    expect(
      screen.queryByRole("button", { name: /Main Rotor/i }),
    ).not.toBeInTheDocument();
  });

  it("toggles the motor with the inverse of current state", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        servo({ partId: "11", servoMotorIsEngaged: true }),
      ]);
    });

    await user.click(screen.getByRole("button", { name: /Motor on/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setMotor[11,false]");
  });

  it("selects a joint from the list and targets it", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        servo({ partId: "11", partName: "Hinge A", targetAngle: 30 }),
        servo({
          partId: "22",
          partName: "Piston B",
          type: "piston",
          targetExtension: 60,
        }),
      ]);
    });

    await user.click(screen.getByRole("button", { name: /Piston B/i }));
    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setTarget[22,65]");
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
