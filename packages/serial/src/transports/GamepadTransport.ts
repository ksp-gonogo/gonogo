// GamepadTransport — the Web Gamepad API as a DeviceTransport.
//
// Hand-rolled, no npm dependency. Every candidate library was evaluated and
// rejected during design: `react-gamepad` is GPL-3.0 and last touched 2019;
// `joymap` pulls `lodash/fp` at 20 sites and duplicates our shaping/binding
// layer; `gamepad-type` pulls `ansi-styles` into a browser lib at 0 stars;
// `gamepad_standardizer` has one force-pushed commit. The best-maintained
// implementation in the ecosystem (VueUse's `useGamepad`) is 159 lines
// *including* Vue reactivity — this file is the same idea without a
// framework dependency.
//
// `write()` no-ops in v1 — rumble is deferred (see the Wednesday Work
// gamepad-transport spec's Out of scope: Firefox has no `playEffect` at
// all, and DualSense gets no rumble on Chrome/Linux since `0ce6` is absent
// from Chromium's Dualshock4 allow-list).
import { PerfBudget } from "@ksp-gonogo/core";
import { buildGamepadInputs, gamepadTypeId } from "../gamepadShape";
import { applyAnalogShaping } from "../parsers/analogShaping";
import type { DeviceInput, DeviceType } from "../types";
import type {
  DeviceTransport,
  InputEvent,
  InputValue,
  SchemaUpdate,
  TransportStatus,
} from "./DeviceTransport";
import { GamepadPoller } from "./GamepadPoller";

/** Sticks jitter at rest; suppress emission below this magnitude of change
 *  so idle noise doesn't run the dispatcher every frame. Separate from —
 *  and in addition to — the user's own deadzone setting. Chromium already
 *  applies its own ~0.01 button-axis deadzone, so this can stay small. */
const AXIS_CHANGE_EPSILON = 0.002;

const GAMEPAD_INPUT_BUDGET = new PerfBudget({
  name: "GamepadTransport input events/sec",
  threshold: 1000,
  windowMs: 1000,
  unit: "events",
});

export interface GamepadTransportOptions {
  id: string;
  deviceType: DeviceType;
  /** Remembered physical-pad id from a previous pairing, if any. Absent for
   *  a brand new device — first pairing requires a press (see connect()). */
  gamepadId?: string;
}

function readLivePads(): Gamepad[] {
  const nav = (
    globalThis as {
      navigator?: { getGamepads?: () => (Gamepad | null)[] | null };
    }
  ).navigator;
  const raw = nav?.getGamepads?.() ?? [];
  return Array.from(raw).filter((p): p is Gamepad => p !== null);
}

export class GamepadTransport implements DeviceTransport {
  readonly id: string;
  status: TransportStatus = "disconnected";

  private deviceType: DeviceType;
  private gamepadId: string | undefined;
  private resolvedIndex: number | null = null;
  private readonly lastValues = new Map<string, InputValue>();

  private readonly inputListeners = new Set<(event: InputEvent) => void>();
  private readonly statusListeners = new Set<
    (status: TransportStatus, err?: unknown) => void
  >();
  private readonly schemaListeners = new Set<(update: SchemaUpdate) => void>();

  private connectedListener: ((evt: Event) => void) | null = null;
  private disconnectedListener: ((evt: Event) => void) | null = null;
  /** Unsubscribe from the shared poller's frame loop. Set by `adopt()`,
   *  cleared by `disconnect()` — without this the poller's subscriber Set
   *  never returns to zero and its rAF loop never stops (see the
   *  gamepad-transport review, finding #1). */
  private frameUnsubscribe: (() => void) | null = null;

  constructor(opts: GamepadTransportOptions) {
    this.id = opts.id;
    this.deviceType = opts.deviceType;
    this.gamepadId = opts.gamepadId;
  }

  connect(): Promise<void> {
    if (this.status === "connected") return Promise.resolve();
    this.attachDisconnectedListener();

    const existing = this.findClaimableLivePad();
    if (existing) {
      this.adopt(existing);
      return Promise.resolve();
    }

    // No (unclaimed) live pad yet — the Gamepad API withholds
    // `getGamepads()` results until a user gesture is seen on the pad, so
    // `gamepadconnected` fires on first press, not on plug-in. Wait for it;
    // the UI is responsible for prompting "press any button to pair".
    this.attachConnectedListener();
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.detachConnectedListener();
    this.detachDisconnectedListener();
    if (this.frameUnsubscribe) {
      this.frameUnsubscribe();
      this.frameUnsubscribe = null;
    }
    if (this.resolvedIndex !== null) {
      GamepadPoller.get().release(this.resolvedIndex);
    }
    this.resolvedIndex = null;
    this.lastValues.clear();
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  /** Rumble is deferred — see the Out of scope section of the
   *  gamepad-transport spec. No web API exposes adaptive triggers, Firefox
   *  has no `playEffect` at all, and DualSense gets no rumble on
   *  Chrome/Linux (0ce6 is absent from Chromium's allow-list). */
  write(_data: string | Uint8Array): Promise<void> {
    return Promise.resolve();
  }

  onInput(cb: (event: InputEvent) => void): () => void {
    this.inputListeners.add(cb);
    return () => {
      this.inputListeners.delete(cb);
    };
  }

  onStatus(cb: (status: TransportStatus, err?: unknown) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  onSchema(cb: (update: SchemaUpdate) => void): () => void {
    this.schemaListeners.add(cb);
    return () => {
      this.schemaListeners.delete(cb);
    };
  }

  updateDeviceType(type: DeviceType): void {
    this.deviceType = type;
  }

  // ---- internals ------------------------------------------------------

  private findClaimableLivePad(): Gamepad | null {
    if (!this.gamepadId) {
      // First pairing: nothing to match on yet. Never blind-grab an
      // already-visible pad — it could be claimed by another device, or
      // simply the wrong physical controller. Always require a press.
      return null;
    }
    const poller = GamepadPoller.get();
    const candidates = readLivePads().filter(
      (p) => p.id === this.gamepadId && !poller.isClaimed(p.index),
    );
    if (candidates.length === 0) return null;
    // Rare, but some platforms can expose the same physical pad through
    // two simultaneous entries — one "standard"-mapped, one not. Prefer
    // the standard one: it carries real role information, the non-standard
    // one would only give a generic-names degraded pairing for no reason.
    return candidates.find((p) => p.mapping === "standard") ?? candidates[0];
  }

  private attachConnectedListener(): void {
    if (this.connectedListener) return;
    this.connectedListener = (evt: Event) => {
      const pad = (evt as Event & { gamepad?: Gamepad }).gamepad;
      if (!pad) return;
      const poller = GamepadPoller.get();
      if (poller.isClaimed(pad.index)) return;
      if (this.gamepadId) {
        // Reconnecting a known pad — ignore a press on a different one,
        // and re-resolve against every currently-live matching candidate
        // (not just the one that just fired) so a standard-mapped
        // duplicate wins over a non-standard one if both are visible.
        if (pad.id !== this.gamepadId) return;
        const resolved = this.findClaimableLivePad();
        if (resolved) this.adopt(resolved);
        return;
      }
      // First pairing — nothing to compare against yet; the press itself
      // is ground truth.
      this.adopt(pad);
    };
    window.addEventListener("gamepadconnected", this.connectedListener);
  }

  private detachConnectedListener(): void {
    if (!this.connectedListener) return;
    window.removeEventListener("gamepadconnected", this.connectedListener);
    this.connectedListener = null;
  }

  private attachDisconnectedListener(): void {
    if (this.disconnectedListener) return;
    this.disconnectedListener = (evt: Event) => {
      const pad = (evt as Event & { gamepad?: Gamepad }).gamepad;
      if (!pad) return;
      if (this.resolvedIndex !== pad.index) return;
      void this.disconnect();
    };
    window.addEventListener("gamepaddisconnected", this.disconnectedListener);
  }

  private detachDisconnectedListener(): void {
    if (!this.disconnectedListener) return;
    window.removeEventListener(
      "gamepaddisconnected",
      this.disconnectedListener,
    );
    this.disconnectedListener = null;
  }

  private adopt(pad: Gamepad): void {
    this.resolvedIndex = pad.index;
    this.gamepadId = pad.id;
    GamepadPoller.get().claim(pad.index);
    this.detachConnectedListener();
    this.primeBaseline(pad);
    this.emitSchema(pad);
    // Defensive against double-subscribe: if a previous subscription is
    // still live (shouldn't happen in the normal connect/disconnect flow,
    // but re-adoption paths are cheap to guard), drop it before adding a
    // new one so re-adopt/rebuild never accumulates listeners.
    if (this.frameUnsubscribe) {
      this.frameUnsubscribe();
    }
    this.frameUnsubscribe = GamepadPoller.get().subscribe((pads) => {
      this.handleFrame(pads);
    });
    this.setStatus("connected");
  }

  /**
   * Seed `lastValues` from the pad's state *at the moment of adoption*,
   * without emitting anything. Without this, the first poller tick after
   * connect would see every input as "changed" (from unset) and fire a
   * burst of events for the pad's whole rest state — which is exactly the
   * "unconditional emit" bug the change-only diffing is meant to catch.
   * The pad's rest state at connect isn't news; only what changes after it
   * is.
   */
  private primeBaseline(pad: Gamepad): void {
    this.lastValues.clear();
    for (let i = 0; i < pad.buttons.length; i++) {
      const inputId = `button-${i}`;
      const input = this.findInput(inputId);
      if (input?.kind === "analog") {
        this.lastValues.set(
          inputId,
          applyAnalogShaping(input, pad.buttons[i].value),
        );
      } else {
        this.lastValues.set(inputId, pad.buttons[i].pressed);
      }
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const inputId = `axis-${i}`;
      this.lastValues.set(
        inputId,
        applyAnalogShaping(this.findInput(inputId) ?? {}, pad.axes[i]),
      );
    }
  }

  private emitSchema(pad: Gamepad): void {
    const inputs = buildGamepadInputs(
      pad.buttons.length,
      pad.axes.length,
      pad.mapping,
    );
    const typeId = gamepadTypeId(
      pad.buttons.length,
      pad.axes.length,
      pad.mapping,
    );
    const update: SchemaUpdate = { inputs, typeId, gamepadId: pad.id };
    this.schemaListeners.forEach((cb) => {
      cb(update);
    });
  }

  private handleFrame(pads: readonly (Gamepad | null)[]): void {
    if (this.resolvedIndex === null) return;
    const pad = pads[this.resolvedIndex] ?? null;
    if (!pad || (this.gamepadId && pad.id !== this.gamepadId)) {
      // The pad vanished from this slot (or a different physical pad now
      // occupies it) between disconnect-event delivery and this tick —
      // treat it the same as an explicit disconnect.
      void this.disconnect();
      return;
    }
    for (let i = 0; i < pad.buttons.length; i++) {
      this.processButton(i, pad.buttons[i]);
    }
    for (let i = 0; i < pad.axes.length; i++) {
      this.processAxis(i, pad.axes[i]);
    }
  }

  private findInput(inputId: string): DeviceInput | undefined {
    return this.deviceType.inputs.find((i) => i.id === inputId);
  }

  private processButton(index: number, button: GamepadButton): void {
    const inputId = `button-${index}`;
    const input = this.findInput(inputId);
    if (input?.kind === "analog") {
      this.emitAnalog(inputId, input, button.value);
    } else {
      this.emitDigital(inputId, button.pressed);
    }
  }

  private processAxis(index: number, raw: number): void {
    const inputId = `axis-${index}`;
    this.emitAnalog(inputId, this.findInput(inputId), raw);
  }

  private emitDigital(inputId: string, pressed: boolean): void {
    if (this.lastValues.get(inputId) === pressed) return;
    this.lastValues.set(inputId, pressed);
    this.emit(inputId, pressed);
  }

  private emitAnalog(
    inputId: string,
    input: DeviceInput | undefined,
    raw: number,
  ): void {
    const shaped = applyAnalogShaping(input ?? {}, raw);
    const prev = this.lastValues.get(inputId);
    if (
      typeof prev === "number" &&
      Math.abs(prev - shaped) < AXIS_CHANGE_EPSILON
    ) {
      return;
    }
    this.lastValues.set(inputId, shaped);
    this.emit(inputId, shaped);
  }

  private emit(inputId: string, value: InputValue): void {
    GAMEPAD_INPUT_BUDGET.record();
    const event: InputEvent = { inputId, value };
    this.inputListeners.forEach((cb) => {
      cb(event);
    });
  }

  private setStatus(status: TransportStatus, err?: unknown): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status, err);
    });
  }
}
