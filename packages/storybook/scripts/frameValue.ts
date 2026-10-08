import type { PlaybackFrame } from "./playbackTypes";

/** One member of an object a frame carries, or `undefined` when it is not there. */
export function at(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** What `channel` was given on `frame`. */
export function sentOn(frame: PlaybackFrame, channel: string): unknown {
  return frame.emits.find((e) => e.channel === channel)?.value;
}

export function numberAt(value: unknown, key: string): number {
  const found = at(value, key);
  if (typeof found !== "number") throw new Error(`${key} is not a number`);
  return found;
}

export function booleanAt(value: unknown, key: string): boolean {
  const found = at(value, key);
  if (typeof found !== "boolean") throw new Error(`${key} is not a boolean`);
  return found;
}

export function lengthOf(value: unknown): number {
  if (!Array.isArray(value)) throw new Error("not a list");
  return value.length;
}
