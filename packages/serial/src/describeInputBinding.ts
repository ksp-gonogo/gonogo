import type { InputBinding } from "./bindings";
import { describeGamepadInput } from "./gamepadDisplay";
import type { SerialDeviceService } from "./SerialDeviceService";

/**
 * A bound input as the operator reads it: "key K" for the keyboard, otherwise
 * the device's name followed by the input's name ("Pad 1 Cross"). Names an
 * input of a device this screen does not have by its input id alone. Used by
 * notices and lists that say which input does something.
 */
export function describeInputBinding(
  service: SerialDeviceService,
  binding: InputBinding,
): string {
  const device = service.getDevices().find((d) => d.id === binding.deviceId);
  const type = device
    ? service.getDeviceTypes().find((t) => t.id === device.typeId)
    : undefined;
  const input = type?.inputs.find((i) => i.id === binding.inputId);
  if (!device || !input) return binding.inputId;
  const { name } = describeGamepadInput(device, input);
  return device.transport === "keyboard"
    ? `key ${name}`
    : `${device.name} ${name}`;
}
