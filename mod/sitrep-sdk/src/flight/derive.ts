import type { DataKeyMeta, Sample } from "./types";

/**
 * A value computed from recorded keys and recorded beside them, such as a rate
 * of change. Useful for plotting a figure the vessel does not report, such as
 * altitude rate, beside the recorded keys. Taken by {@link registerDerivedKey}
 * and returned by {@link getDerivedKeys}.
 *
 * @category Flight recording
 */
export interface DerivedKeyDef {
  /** Key that will be emitted, e.g. `"v.altitudeRate"`. Must not collide with raw keys. */
  id: string;
  /**
   * Raw keys this derivation depends on. Only raw source keys are supported,
   * derived-of-derived is not allowed in v1.
   */
  inputs: readonly string[];
  /** Human-facing metadata for the picker and axis labels. */
  meta: Omit<DataKeyMeta, "key">;
  /**
   * Compute the derived value.
   * `inputs`: latest Sample (t + v) for each entry in `def.inputs`, same order.
   * `previous`: inputs from the last invocation, or `null` on the first call.
   * Return `undefined` to skip emission this tick (e.g. first sample of a
   * rate-of-change key where no previous sample exists yet).
   */
  fn: (inputs: Sample[], previous: Sample[] | null) => unknown;
}

const registry: DerivedKeyDef[] = [];

/**
 * Adds a derived key, computed for every flight recorded from then on. Useful
 * for letting the operator plot a computed figure beside recorded telemetry.
 * Used for the built-in derived keys such as rates of change.
 *
 * @category Flight recording
 */
export function registerDerivedKey(def: DerivedKeyDef): void {
  registry.push(def);
}

/**
 * Every registered derived key, in registration order. Useful for the code that
 * records a flight and must compute each derived key beside the raw ones. Used
 * by {@link BufferedDataSource}.
 *
 * @category Flight recording
 */
export function getDerivedKeys(): readonly DerivedKeyDef[] {
  return registry;
}

/**
 * Removes every derived key registered with {@link registerDerivedKey}. Useful
 * for resetting between tests; a running app never calls it.
 *
 * @category Flight recording
 */
export function clearDerivedKeys(): void {
  registry.length = 0;
}
