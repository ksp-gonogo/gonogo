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
import { parseRotors, RotorTachometerComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "robotics.rotors" },
  { key: "robotics.available" },
];

const rotor = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  partId: 101,
  name: "Rotor A",
  rpm: 120,
  rpmLimit: 200,
  torqueLimit: 80,
  maxTorque: 400,
  brakePercentage: 0,
  motorEngaged: true,
  locked: false,
  counterClockwise: false,
  output: 0.6,
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
      source.emit("robotics.rotors", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-rotors state when available but the list is empty", () => {
    renderRotor();
    act(() => {
      source.emit("robotics.available", true);
      source.emit("robotics.rotors", []);
    });
    expect(screen.getByText(/No rotors on this vessel/i)).toBeInTheDocument();
  });

  it("shows the no-rotors state when the key is absent (older fork)", () => {
    renderRotor();
    // Nothing emitted — both keys undefined.
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
      source.emit("robotics.rotors", [rotor({ rpm: 120, rpmLimit: 200 })]);
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
      source.emit("robotics.rotors", [rotor({ motorEngaged: true })]);
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
      source.emit("robotics.rotors", [
        rotor({ partId: 101, name: "Rotor A", rpmLimit: 200 }),
        rotor({ partId: 202, name: "Rotor B", rpmLimit: 50 }),
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
  it("returns null for absent or non-array input", () => {
    expect(parseRotors(undefined)).toBeNull();
    expect(parseRotors(null)).toBeNull();
    expect(parseRotors({})).toBeNull();
  });

  it("drops entries with no numeric partId and coerces fields", () => {
    const parsed = parseRotors([{ partId: 1, rpm: 50 }, { name: "no id" }]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.partId).toBe(1);
    expect(parsed?.[0]?.rpm).toBe(50);
    expect(parsed?.[0]?.motorEngaged).toBe(false);
    expect(parsed?.[0]?.name).toBe("Rotor 1");
  });
});
