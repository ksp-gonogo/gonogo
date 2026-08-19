import type { DataKeyMeta, Sample } from "./types";

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

export function registerDerivedKey(def: DerivedKeyDef): void {
  registry.push(def);
}

export function getDerivedKeys(): readonly DerivedKeyDef[] {
  return registry;
}

/** Remove all registered derived keys. Only call from tests. */
export function clearDerivedKeys(): void {
  registry.length = 0;
}
