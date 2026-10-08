import { dispatchAction } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import "./index";

const INSTANCE = "rt-actions";

const part = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
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

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(entry: Record<string, unknown>) {
  const fixture = setupStreamFixture({ pinnedUt: 10 });
  const result = renderWidget("rotor-tachometer", {
    instanceId: INSTANCE,
    config: {},
    w: 6,
    h: 10,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(result.unmount);
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    fixture.emit("robotics.available", { available: true });
    fixture.emit("robotics.servos", [entry]);
  });
  return fixture;
}

const lockCommands = (fixture: ReturnType<typeof mount>) =>
  fixture.transport.sentCommands.filter(
    (c) => c.command === "robotics.rotor.setLock",
  );

const toggleLock = (value = true) =>
  dispatchAction(INSTANCE, "toggle-lock", { kind: "button", value });

describe("RotorTachometer toggle-lock", () => {
  it("locks an unlocked part and reports the new state", async () => {
    const fixture = mount(part({ servoIsLocked: false }));
    await screen.findByRole("button", { name: /Lock/i });

    let result: unknown;
    act(() => {
      result = toggleLock();
    });

    await waitFor(() => expect(lockCommands(fixture)).toHaveLength(1));
    expect(lockCommands(fixture)[0]?.args).toEqual({
      partId: "101",
      enabled: true,
    });
    expect(result).toEqual({ Locked: true });
  });

  it("unlocks a locked part and reports the new state", async () => {
    const fixture = mount(part({ servoIsLocked: true }));
    await screen.findByRole("button", { name: /Lock/i });

    let result: unknown;
    act(() => {
      result = toggleLock();
    });

    await waitFor(() => expect(lockCommands(fixture)).toHaveLength(1));
    expect(lockCommands(fixture)[0]?.args).toEqual({
      partId: "101",
      enabled: false,
    });
    expect(result).toEqual({ Locked: false });
  });

  it("sends nothing when the lock state was never read", async () => {
    const fixture = mount(part({ servoIsLocked: null }));
    await screen.findByRole("button", { name: /Lock/i });

    let result: unknown = "unset";
    act(() => {
      result = toggleLock();
    });
    await act(async () => {});

    expect(result).toBeUndefined();
    expect(lockCommands(fixture)).toEqual([]);
  });

  it("ignores the release of the button", async () => {
    const fixture = mount(part({ servoIsLocked: false }));
    await screen.findByRole("button", { name: /Lock/i });

    let result: unknown = "unset";
    act(() => {
      result = toggleLock(false);
    });
    await act(async () => {});

    expect(result).toBeUndefined();
    expect(lockCommands(fixture)).toEqual([]);
  });
});
