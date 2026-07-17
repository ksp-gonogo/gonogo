import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { parseServos, RoboticsConsoleComponent } from "./index";

/**
 * RoboticsConsole runs genuinely off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` —
 * `parts.robotics` is its whole identity list and `robotics.available` its
 * DLC-presence flag, both canonical stream reads (`useTelemetry`, no legacy
 * fallback). Command dispatch (`robotics.servo.*`) still routes through the
 * legacy `DataSource`'s `execute()` — no mod command handler exists for it
 * yet — so a plain `setupMockDataSource` registered under `"data"` captures
 * those calls; it carries no keys of its own and is never read from.
 */

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler registry — clearActionHandlers() firing on a still-mounted
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

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        servo({ partId: "11", currentAngle: 30, targetAngle: 30 }),
      ]);
    });

    expect(await screen.findByText(/AT TARGET/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setTarget[11,35]");

    teardownMockDataSource(legacyAux);
  });

  it("uses % units for pistons", async () => {
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
          currentExtension: 40,
          targetExtension: 60,
        }),
      ]);
    });
    expect(await screen.findByText(/MOVING/i)).toBeInTheDocument();
    // Stepper value shows the piston target with a % unit.
    expect(screen.getByText("60%")).toBeInTheDocument();
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

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        servo({ partId: "11", servoMotorIsEngaged: true }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Motor on/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setMotor[11,false]");

    teardownMockDataSource(legacyAux);
  });

  it("selects a joint from the list and targets it", async () => {
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

    renderConsole(fixture);
    act(() => {
      fixture.emit("robotics.available", { available: true });
      fixture.emit("parts.robotics", [
        servo({ partId: "11", partName: "Hinge A", targetAngle: 30 }),
        servo({
          partId: "22",
          partName: "Piston B",
          type: "piston",
          targetExtension: 60,
        }),
      ]);
    });

    await user.click(await screen.findByRole("button", { name: /Piston B/i }));
    await user.click(screen.getByRole("button", { name: /Increase target/i }));
    expect(onExecute).toHaveBeenCalledWith("robotics.servo.setTarget[22,65]");

    teardownMockDataSource(legacyAux);
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
