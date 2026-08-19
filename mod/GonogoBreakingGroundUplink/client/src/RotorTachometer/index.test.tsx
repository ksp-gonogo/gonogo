import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  clearActionHandlers,
  DashboardItemContext,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { parseRotors, RotorTachometerComponent } from "./index";

/**
 * RotorTachometer runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`:
 * `robotics.servos` is its whole identity list (filtered to `type === "rotor"`)
 * and `robotics.available` its DLC-presence flag (canonical stream reads,
 * `useTelemetry`), and `robotics.rotor.*` command dispatch (delayed-command-
 * ux robotics migration) rides the same stream via `useCommand`, asserted
 * against `fixture.transport.sentCommands`.
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

const CARRIED = ["robotics.servos", "robotics.available"];

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
      fixture.emit("robotics.servos", []);
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
      fixture.emit("robotics.servos", []);
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

  it("ignores hinge/piston entries in the same robotics.servos array", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        { partId: "5", partName: "Arm Hinge", type: "hinge" },
      ]);
    });
    expect(
      await screen.findByText(/No rotors on this vessel/i),
    ).toBeInTheDocument();
  });

  it("renders live RPM and fires setRpmLimit when raising the cap", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        rotor({ currentRPM: 120, rpmLimit: 200 }),
      ]);
    });

    await waitFor(() => expect(visibleText()).toContain("120")); // gauge value label

    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "101", value: 210 });
    });
  });

  it("toggles the motor with the inverse of current state", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [rotor({ servoMotorIsEngaged: true })]);
    });

    await user.click(await screen.findByRole("button", { name: /Motor on/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.rotor.setMotor",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "101", enabled: false });
    });
  });

  it("selects a rotor from the list and targets it", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });

    renderRotor(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("robotics.servos", [
        rotor({ partId: "101", partName: "Rotor A", rpmLimit: 200 }),
        rotor({ partId: "202", partName: "Rotor B", rpmLimit: 50 }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Rotor B/i }));
    await user.click(screen.getByRole("button", { name: /Raise RPM cap/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "robotics.rotor.setRpmLimit",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ partId: "202", value: 60 });
    });
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
