import { GamepadPoller } from "../transports/GamepadPoller";

/**
 * `navigator.getGamepads()` + `gamepadconnected`/`gamepaddisconnected` test
 * double, modelled on `mockWebSerial.ts`: the consuming code
 * (GamepadTransport, GamepadPoller) calls exactly the real browser APIs;
 * tests install the mock once, connect/disconnect pads, and mutate their
 * live button/axis state directly — then call `step()` to advance the
 * poller by one frame, deterministically, with no real `requestAnimationFrame`
 * involved at all (`GamepadPoller.tick()` is a plain synchronous method;
 * `step()` just calls it).
 *
 * Unlike `navigator.serial`, `navigator.getGamepads` is the only piece
 * patched — `gamepadconnected`/`gamepaddisconnected` are ordinary DOM
 * events, so they're dispatched via the real `window.dispatchEvent` rather
 * than a parallel listener registry.
 */

export interface MockGamepadSpec {
  id: string;
  /** W3C `mapping` string. `"standard"` or `""` are the two platforms this
   *  transport actually has to handle; anything else is treated the same
   *  as `""` (non-standard). */
  mapping?: string;
  buttonCount?: number;
  axisCount?: number;
}

interface MutableButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

function buildGamepad(index: number, spec: MockGamepadSpec): Gamepad {
  const buttons: MutableButton[] = Array.from(
    { length: spec.buttonCount ?? 17 },
    () => ({ pressed: false, touched: false, value: 0 }),
  );
  const axes: number[] = Array.from({ length: spec.axisCount ?? 4 }, () => 0);

  return {
    id: spec.id,
    index,
    connected: true,
    mapping: (spec.mapping ?? "standard") as GamepadMappingType,
    timestamp: 0,
    buttons: buttons as unknown as readonly GamepadButton[],
    axes: axes as unknown as readonly number[],
    hapticActuators: [],
    vibrationActuator: null as unknown as Gamepad["vibrationActuator"],
  } as Gamepad;
}

export class MockGamepadAPI {
  private pads = new Map<number, Gamepad>();
  private previousGetGamepads: (() => (Gamepad | null)[]) | undefined;
  private hadGetGamepads = false;
  private installed = false;

  install(): void {
    if (!globalThis.navigator) {
      globalThis.navigator = {} as Navigator;
    }
    const nav = globalThis.navigator as Navigator & {
      getGamepads?: () => (Gamepad | null)[];
    };
    this.hadGetGamepads = "getGamepads" in nav;
    this.previousGetGamepads = nav.getGamepads?.bind(nav);
    nav.getGamepads = () => this.snapshot();
    this.installed = true;
    GamepadPoller.resetForTests();
  }

  restore(): void {
    if (!this.installed) return;
    const nav = globalThis.navigator as Navigator & {
      getGamepads?: () => (Gamepad | null)[];
    };
    if (this.hadGetGamepads && this.previousGetGamepads) {
      nav.getGamepads = this.previousGetGamepads;
    } else {
      delete (nav as { getGamepads?: unknown }).getGamepads;
    }
    this.pads.clear();
    this.installed = false;
    GamepadPoller.resetForTests();
  }

  private snapshot(): (Gamepad | null)[] {
    if (this.pads.size === 0) return [];
    const maxIndex = Math.max(...this.pads.keys());
    const out: (Gamepad | null)[] = [];
    for (let i = 0; i <= maxIndex; i++) out.push(this.pads.get(i) ?? null);
    return out;
  }

  /** Connect a mock pad at `index` and dispatch a real `gamepadconnected`
   *  window event carrying it — mirrors the browser firing on first input,
   *  not on physical plug-in. */
  connectPad(index: number, spec: MockGamepadSpec): Gamepad {
    const gp = buildGamepad(index, spec);
    this.pads.set(index, gp);
    const evt = Object.assign(new Event("gamepadconnected"), { gamepad: gp });
    window.dispatchEvent(evt);
    return gp;
  }

  /** Remove a pad and dispatch `gamepaddisconnected`. */
  disconnectPad(index: number): void {
    const gp = this.pads.get(index);
    if (!gp) return;
    this.pads.delete(index);
    const evt = Object.assign(new Event("gamepaddisconnected"), {
      gamepad: gp,
    });
    window.dispatchEvent(evt);
  }

  /** Set a button's `.pressed`/`.value` on a live pad, in place — mutating
   *  the same object `getGamepads()` returns, matching the real API's
   *  live-object semantics. No event fires; production code only learns of
   *  this on the next poller tick. */
  setButton(
    index: number,
    buttonIndex: number,
    patch: Partial<MutableButton>,
  ): void {
    const gp = this.pads.get(index);
    if (!gp) throw new Error(`MockGamepadAPI: no pad at index ${index}`);
    const button = gp.buttons[buttonIndex] as MutableButton | undefined;
    if (!button) {
      throw new Error(
        `MockGamepadAPI: pad ${index} has no button ${buttonIndex}`,
      );
    }
    Object.assign(button, patch);
  }

  /** Set an axis value on a live pad, in place. */
  setAxis(index: number, axisIndex: number, value: number): void {
    const gp = this.pads.get(index);
    if (!gp) throw new Error(`MockGamepadAPI: no pad at index ${index}`);
    const axes = gp.axes as unknown as number[];
    if (axisIndex < 0 || axisIndex >= axes.length) {
      throw new Error(`MockGamepadAPI: pad ${index} has no axis ${axisIndex}`);
    }
    axes[axisIndex] = value;
  }

  /** Advance the shared GamepadPoller by exactly one frame. */
  step(): void {
    GamepadPoller.get().tick();
  }
}
