import { afterEach, describe, expect, it, vi } from "vitest";
import { MockGamepadAPI } from "../mocks/mockGamepad";
import { GamepadPoller } from "./GamepadPoller";

describe("GamepadPoller", () => {
  const mock = new MockGamepadAPI();

  afterEach(() => {
    mock.restore();
    // Belt-and-braces: mock.restore() only resets the poller when the mock
    // was actually installed in this test. Reset unconditionally so a test
    // that skips the mock never leaks claims/subscribers into the next one.
    GamepadPoller.resetForTests();
  });

  it("is a singleton", () => {
    expect(GamepadPoller.get()).toBe(GamepadPoller.get());
  });

  it("notifies every subscriber on tick() with the current snapshot", () => {
    mock.install();
    mock.connectPad(0, { id: "Pad A" });
    const poller = GamepadPoller.get();
    const a = vi.fn();
    const b = vi.fn();
    poller.subscribe(a);
    poller.subscribe(b);

    poller.tick();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0][0]?.id).toBe("Pad A");
  });

  it("starts one shared requestAnimationFrame loop regardless of subscriber count", () => {
    mock.install();
    const raf = vi.fn(() => 1);
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);

    const poller = GamepadPoller.get();
    const unsubA = poller.subscribe(() => {});
    const unsubB = poller.subscribe(() => {});
    const unsubC = poller.subscribe(() => {});

    // One loop was scheduled for the first subscriber; the 2nd/3rd
    // subscribers must not each start their own.
    expect(raf).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
    expect(caf).not.toHaveBeenCalled();
    unsubC();
    // Last unsubscribe stops the loop.
    expect(caf).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("unsubscribe stops further notifications to that listener", () => {
    mock.install();
    const poller = GamepadPoller.get();
    const spy = vi.fn();
    const unsub = poller.subscribe(spy);
    poller.tick();
    unsub();
    poller.tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("claim/release/isClaimed track claimed pad indices", () => {
    const poller = GamepadPoller.get();
    expect(poller.isClaimed(0)).toBe(false);
    poller.claim(0);
    expect(poller.isClaimed(0)).toBe(true);
    poller.release(0);
    expect(poller.isClaimed(0)).toBe(false);
  });

  it("resetForTests clears listeners and claims", () => {
    const poller = GamepadPoller.get();
    poller.claim(0);
    poller.subscribe(() => {});
    expect(poller.subscriberCount).toBe(1);

    GamepadPoller.resetForTests();

    const fresh = GamepadPoller.get();
    expect(fresh).not.toBe(poller);
    expect(fresh.subscriberCount).toBe(0);
    expect(fresh.isClaimed(0)).toBe(false);
  });
});
