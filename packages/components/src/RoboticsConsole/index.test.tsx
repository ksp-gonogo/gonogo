import {
  DashboardItemContext,
  type DataKey,
  type MockDataSource,
} from "@gonogo/core";
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
  { key: "robotics.servos" },
  { key: "robotics.available" },
];

const servo = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: 11,
  name: "Hinge A",
  type: "hinge",
  current: 30,
  target: 30,
  atTarget: true,
  motorEngaged: true,
  locked: false,
  torqueLimit: 100,
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
      source.emit("robotics.servos", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when available but the list is empty", () => {
    renderConsole();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("robotics.servos", []);
    });
    expect(
      screen.getByText(/No robotic parts on this vessel/i),
    ).toBeInTheDocument();
  });

  it("shows the no-parts state when the key is absent (older fork)", () => {
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
      source.emit("robotics.servos", [
        servo({ partId: 11, current: 30, target: 30 }),
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
      source.emit("robotics.servos", [
        servo({
          partId: 12,
          type: "piston",
          current: 40,
          target: 60,
          atTarget: false,
        }),
      ]);
    });
    expect(screen.getByText(/MOVING/i)).toBeInTheDocument();
    // Stepper value shows the piston target with a % unit.
    expect(screen.getByText("60%")).toBeInTheDocument();
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
      source.emit("robotics.servos", [
        servo({ partId: 11, motorEngaged: true }),
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
      source.emit("robotics.servos", [
        servo({ partId: 11, name: "Hinge A", target: 30 }),
        servo({ partId: 22, name: "Piston B", type: "piston", target: 60 }),
      ]);
    });

    await user.click(screen.getByRole("button", { name: /Piston B/i }));
    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setTarget[22,65]");
  });
});

describe("parseServos", () => {
  it("returns null for absent or non-array input", () => {
    expect(parseServos(undefined)).toBeNull();
    expect(parseServos(null)).toBeNull();
    expect(parseServos({})).toBeNull();
  });

  it("drops entries with no partId and defaults type to hinge", () => {
    const parsed = parseServos([
      { partId: 5, current: 10 },
      { type: "piston" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.type).toBe("hinge");
    expect(parsed?.[0]?.current).toBe(10);
  });
});
