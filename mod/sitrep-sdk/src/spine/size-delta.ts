import type { SizeDelta } from "../api/types";

/**
 * Refuses an extension's size request that is not a whole number of zero or
 * more on either axis, naming the extension. An extension asks a widget for
 * room and never takes it away, so a negative request is an error rather than
 * a clamp, and a fraction has no grid cell to be counted in.
 */
export function assertSizeDelta(
  owner: string,
  delta: SizeDelta | undefined,
): void {
  if (delta === undefined) return;
  for (const axis of ["w", "h"] as const) {
    const n = delta[axis];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Extension "${owner}" declares sizeDelta.${axis} = ${n}. A size delta is a whole number of grid units, zero or more.`,
      );
    }
  }
}
