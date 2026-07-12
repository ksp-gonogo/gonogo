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
import { parseRotors, RotorTachometerComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "parts.robotics" },
  { key: "robotics.available" },
];

const rotor = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: "101",
  partName: "Rotor A",
  type: "rotor",
  currentRPM: 120,
  rpmLimit: 200,
  servoMotorLimit: 80,
  maxTorque: 400,
  brakePercentage: 0,
  servoMotorIsEngaged: true,
  servoIsLocked: false,
  counterClockwise: false,
  normalizedOutput: 0.6,
  ...over,
});

function renderRotor() {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "rt" }}>
      <RotorTachometerComponent config={{}} id="rt" />
    </DashboardItemContext.Provider>,
  );
}

describe("RotorTachometerComponent", () => {
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
    renderRotor();
    act(() => {
      source.emit("robotics.available", false);
      source.emit("parts.robotics", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-rotors state when available but the list is empty", () => {
    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", []);
    });
    expect(screen.getByText(/No rotors on this vessel/i)).toBeInTheDocument();
  });

  it("shows the no-rotors state when the key is absent", () => {
    renderRotor();
    // Nothing emitted — both keys undefined.
    expect(screen.getByText(/No rotors on this vessel/i)).toBeInTheDocument();
  });

  it("ignores hinge/piston entries in the same parts.robotics array", () => {
    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        { partId: "5", partName: "Arm Hinge", type: "hinge" },
      ]);
    });
    expect(screen.getByText(/No rotors on this vessel/i)).toBeInTheDocument();
  });

  it("renders live RPM and fires setRpmLimit when raising the cap", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        rotor({ currentRPM: 120, rpmLimit: 200 }),
      ]);
    });

    expect(screen.getByText("120")).toBeInTheDocument(); // gauge value label

    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setRpmLimit[101,210]",
    );
  });

  it("toggles the motor with the inverse of current state", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [rotor({ servoMotorIsEngaged: true })]);
    });

    await user.click(screen.getByRole("button", { name: /Motor on/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setMotor[101,false]",
    );
  });

  it("selects a rotor from the list and targets it", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("parts.robotics", [
        rotor({ partId: "101", partName: "Rotor A", rpmLimit: 200 }),
        rotor({ partId: "202", partName: "Rotor B", rpmLimit: 50 }),
      ]);
    });

    await user.click(screen.getByRole("button", { name: /Rotor B/i }));
    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setRpmLimit[202,60]",
    );
  });
});

describe("parseRotors", () => {
  it("returns an empty list for absent or non-array input", () => {
    expect(parseRotors(undefined)).toEqual([]);
    expect(parseRotors(null)).toEqual([]);
    expect(parseRotors({})).toEqual([]);
  });

  it("drops entries with no string partId or a non-rotor type, and coerces fields", () => {
    const parsed = parseRotors([
      { partId: "1", type: "rotor", currentRPM: 50 },
      { partId: 2, type: "rotor" },
      { partId: "3", type: "hinge", currentRPM: 999 },
      { type: "rotor" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.partId).toBe("1");
    expect(parsed[0]?.rpm).toBe(50);
    expect(parsed[0]?.motorEngaged).toBe(false);
    expect(parsed[0]?.name).toBe("Rotor 1");
  });
});
