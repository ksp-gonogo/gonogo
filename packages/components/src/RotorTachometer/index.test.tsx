import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { parseRotors, RotorTachometerComponent } from "./index";

/**
 * RotorTachometer runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` —
 * `parts.robotics` is its whole identity list (filtered to `type === "rotor"`)
 * and `robotics.available` its DLC-presence flag, both canonical stream reads
 * (`useTelemetry`, no legacy fallback). Command dispatch (`robotics.rotor.*`)
 * still routes through the legacy `DataSource`'s `execute()` — no mod command
 * handler exists for it yet — so a plain `setupMockDataSource` registered
 * under `"data"` captures those calls; it carries no keys of its own.
 */

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

function renderRotor(fixture: ReturnType<typeof setupStreamFixture>) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rt" }}>
        <RotorTachometerComponent config={{}} id="rt" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("RotorTachometerComponent", () => {
  it("shows the DLC-absent state when robotics.available is false", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: false });
      fixture.emit("parts.robotics", []);
    });
    expect(
      await screen.findByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-rotors state when available but the list is empty", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", []);
    });
    expect(
      await screen.findByText(/No rotors on this vessel/i),
    ).toBeInTheDocument();
  });

  it("shows the no-rotors state when nothing has arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderRotor(fixture);
    expect(
      await screen.findByText(/No rotors on this vessel/i),
    ).toBeInTheDocument();
  });

  it("ignores hinge/piston entries in the same parts.robotics array", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        { partId: "5", partName: "Arm Hinge", type: "hinge" },
      ]);
    });
    expect(
      await screen.findByText(/No rotors on this vessel/i),
    ).toBeInTheDocument();
  });

  it("renders live RPM and fires setRpmLimit when raising the cap", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      onExecute,
      connectSource: true,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        rotor({ currentRPM: 120, rpmLimit: 200 }),
      ]);
    });

    expect(await screen.findByText("120")).toBeInTheDocument(); // gauge value label

    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setRpmLimit[101,210]",
    );

    teardownMockDataSource(legacyAux);
  });

  it("toggles the motor with the inverse of current state", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      onExecute,
      connectSource: true,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [rotor({ servoMotorIsEngaged: true })]);
    });

    await user.click(await screen.findByRole("button", { name: /Motor on/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setMotor[101,false]",
    );

    teardownMockDataSource(legacyAux);
  });

  it("selects a rotor from the list and targets it", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [],
      onExecute,
      connectSource: true,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        rotor({ partId: "101", partName: "Rotor A", rpmLimit: 200 }),
        rotor({ partId: "202", partName: "Rotor B", rpmLimit: 50 }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Rotor B/i }));
    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    expect(onExecute).toHaveBeenCalledWith(
      "robotics.rotor.setRpmLimit[202,60]",
    );

    teardownMockDataSource(legacyAux);
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
