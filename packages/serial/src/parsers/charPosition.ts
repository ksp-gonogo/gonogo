import { clamp } from "@ksp-gonogo/core";
import type { InputEvent } from "../transports/DeviceTransport";
import type { DeviceInput } from "../types";
import { applyAnalogShaping } from "./analogShaping";

/**
 * Parse one incoming line using fixed character offsets defined on each
 * input. Button inputs are single-character truthy/falsy (`'0'` → false).
 * Analog inputs are parseInt'd and normalised to `-1..1` using the input's
 * declared `{ min, max }` range.
 *
 * Inputs that fail to parse (out-of-range slice, NaN, invalid kind) are
 * simply skipped — callers see no event for them this tick.
 */
export function parseCharPosition(
  line: string,
  inputs: readonly DeviceInput[],
): InputEvent[] {
  const events: InputEvent[] = [];
  for (const input of inputs) {
    const event = parseOne(line, input);
    if (event) events.push(event);
  }
  return events;
}

function parseOne(line: string, input: DeviceInput): InputEvent | null {
  if (input.offset === undefined || input.length === undefined) return null;
  if (input.offset < 0 || input.offset + input.length > line.length) {
    return null;
  }
  const slice = line.slice(input.offset, input.offset + input.length);

  if (input.kind === "button") {
    const value = slice !== "" && slice !== "0";
    return { inputId: input.id, value };
  }

  if (input.kind === "analog") {
    const raw = Number.parseInt(slice, 10);
    if (Number.isNaN(raw)) return null;
    const min = input.min ?? 0;
    const max = input.max ?? 255;
    if (max === min) return null;
    const normalised = clamp((2 * (raw - min)) / (max - min) - 1, -1, 1);
    return { inputId: input.id, value: applyAnalogShaping(input, normalised) };
  }

  return null;
}
