import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockGamepadAPI } from "./mockGamepad";

describe("MockGamepadAPI", () => {
  let mock: MockGamepadAPI;

  beforeEach(() => {
    mock = new MockGamepadAPI();
    mock.install();
  });

  afterEach(() => {
    mock.restore();
  });

  it("navigator.getGamepads() reflects connected pads, filtering nulls to the max index", () => {
    mock.connectPad(1, { id: "Pad A" });
    const pads = navigator.getGamepads();
    expect(pads).toHaveLength(2);
    expect(pads[0]).toBeNull();
    expect(pads[1]?.id).toBe("Pad A");
  });

  it("dispatches a real gamepadconnected window event carrying the pad", () => {
    const spy = vi.fn();
    window.addEventListener("gamepadconnected", spy);
    mock.connectPad(0, { id: "Pad A" });
    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0] as Event & { gamepad: Gamepad };
    expect(evt.gamepad.id).toBe("Pad A");
    window.removeEventListener("gamepadconnected", spy);
  });

  it("dispatches gamepaddisconnected and leaves a null hole behind (matches the real API's sparse array)", () => {
    mock.connectPad(0, { id: "Pad A" });
    mock.connectPad(1, { id: "Pad B" });
    const spy = vi.fn();
    window.addEventListener("gamepaddisconnected", spy);
    mock.disconnectPad(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const pads = navigator.getGamepads();
    expect(pads[0]).toBeNull();
    expect(pads[1]?.id).toBe("Pad B");
    window.removeEventListener("gamepaddisconnected", spy);
  });

  it("setButton/setAxis mutate the live pad object returned by getGamepads()", () => {
    mock.connectPad(0, { id: "Pad A", buttonCount: 2, axisCount: 2 });
    mock.setButton(0, 0, { pressed: true, value: 1 });
    mock.setAxis(0, 1, 0.75);
    const pad = navigator.getGamepads()[0];
    expect(pad?.buttons[0].pressed).toBe(true);
    expect(pad?.axes[1]).toBe(0.75);
  });

  it("restore() removes the patched getGamepads", () => {
    expect(typeof navigator.getGamepads).toBe("function");
    mock.restore();
    // jsdom doesn't define getGamepads by default, so after restore it
    // should go back to being absent.
    expect(
      (navigator as { getGamepads?: unknown }).getGamepads,
    ).toBeUndefined();
  });
});
