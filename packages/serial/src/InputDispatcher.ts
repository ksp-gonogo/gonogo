import { dispatchAction } from "@ksp-gonogo/core";
import type { InputBinding } from "./bindings";
import type { SerialDeviceService } from "./SerialDeviceService";
import type { InputEvent } from "./transports/DeviceTransport";

/**
 * Minimal shape the dispatcher needs from each dashboard item, structural
 * so @ksp-gonogo/app's `DashboardItem` satisfies it without an explicit import
 * (keeps the dependency flowing app → serial, not the other way).
 */
export interface InputMappingSource {
  readonly i: string;
  readonly inputMappings?: Record<string, InputBinding | null>;
}

/**
 * Minimal shape the dispatcher needs from each saved dashboard layout that a
 * press of an input switches to, structural for the same reason as
 * `InputMappingSource`.
 */
export interface ProfileInputSource {
  readonly id: string;
  readonly inputBinding?: InputBinding | null;
}

interface Options {
  /**
   * Live source of dashboard items. The dispatcher holds a reference and
   * reads it on every serial event, so changes to items or inputMappings are
   * picked up immediately.
   */
  getItems: () => readonly InputMappingSource[];
  service: SerialDeviceService;
  /** Live source of the layouts that an input switches to; read on every event. */
  getProfileBindings?: () => readonly ProfileInputSource[];
  /** Called once per press of an input bound to a layout, with the layout's id. */
  onProfileInput?: (
    profileId: string,
    deviceId: string,
    inputId: string,
  ) => void;
}

/**
 * Routes serial input events to the action dispatcher:
 *
 *   transport.inject / real bytes
 *        → SerialDeviceService.onInput
 *        → InputDispatcher.handleInput
 *        → for each layout whose input was pressed, onProfileInput
 *        → for each dashboard item with a matching mapping,
 *            dispatchAction(instanceId, actionId, payload)
 *        → handler returns { key: value, ... }
 *        → SerialDeviceService.recordActionReturn: debounced render → transport.write()
 *
 * Constructed per-screen; the owner calls `dispose()` on unmount.
 */
export class InputDispatcher {
  private readonly getItems: () => readonly InputMappingSource[];
  private readonly service: SerialDeviceService;
  private readonly getProfileBindings: () => readonly ProfileInputSource[];
  private readonly onProfileInput: NonNullable<Options["onProfileInput"]>;
  private readonly unsubInput: () => void;

  constructor(opts: Options) {
    this.getItems = opts.getItems;
    this.service = opts.service;
    this.getProfileBindings = opts.getProfileBindings ?? (() => []);
    this.onProfileInput = opts.onProfileInput ?? (() => {});
    this.unsubInput = this.service.onInput((deviceId, event) => {
      this.handleInput(deviceId, event);
    });
  }

  dispose(): void {
    this.unsubInput();
  }

  private handleInput(deviceId: string, event: InputEvent): void {
    if (this.service.isCaptureMode()) return;
    if (event.value === true) {
      // The first layout holding the input takes the press, so a press is one switch.
      for (const profile of this.getProfileBindings()) {
        const binding = profile.inputBinding;
        if (
          binding?.deviceId === deviceId &&
          binding.inputId === event.inputId
        ) {
          this.onProfileInput(profile.id, deviceId, event.inputId);
          break;
        }
      }
    }
    const items = this.getItems();
    for (const item of items) {
      const mappings = item.inputMappings;
      if (!mappings) continue;
      for (const [actionId, binding] of Object.entries(mappings)) {
        if (!binding) continue;
        if (binding.deviceId !== deviceId) continue;
        if (binding.inputId !== event.inputId) continue;
        const returned = dispatchAction(item.i, actionId, {
          kind: typeof event.value === "boolean" ? "button" : "analog",
          value: event.value,
        });
        if (returned !== undefined) {
          this.service.recordActionReturn(deviceId, returned);
        }
      }
    }
  }
}
