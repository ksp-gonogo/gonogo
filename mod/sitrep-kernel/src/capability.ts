/**
 * Core capability/provider types for the Sitrep capability kernel.
 *
 * A "capability" is a named extension point (e.g. "comms", "sensors").
 * Providers register against a capability id; `Kernel.resolve()` decides
 * which provider instance(s) are active. An `exclusive` capability activates
 * at most one provider (falling back to its `vanilla` implementation when
 * no provider is registered); a shared (non-exclusive) capability activates
 * every registered provider.
 *
 * Field -> resolution concept:
 *  - `spineCritical`, `versions` -> version gating + spine-halt
 *  - `isDefault`, `priority` -> exclusive-conflict resolution
 *  - `deps` -> dependency broker (topo-sort ordering)
 */

import type { VersionRange } from "./version";

export type CapabilityId = string;

export interface CapabilityDescriptor<T = unknown> {
  id: CapabilityId;
  /** One active provider (exclusive) vs many active providers (shared). */
  exclusive: boolean;
  /** A capability the spine cannot run without: unsatisfiable (no provider, no vanilla) halts resolve(). */
  spineCritical?: boolean;
  /** Always-present, lowest-priority fallback factory. */
  vanilla?: (ctx: ProviderContext) => T;
}

export interface ProviderVersions {
  self: string;
  minKernelVersion?: string;
  targetModVersionRange?: VersionRange;
}

export interface ProviderRegistration<T = unknown> {
  capability: CapabilityId;
  id: string;
  /** Task 4: exclusive-conflict tie-breaking. */
  isDefault?: boolean;
  /** Task 4: exclusive-conflict tie-breaking. */
  priority?: number;
  /** Task 6: capabilities this provider's factory depends on. */
  deps?: CapabilityId[];
  /** Task 5: version gating. */
  versions?: ProviderVersions;
  factory: (ctx: ProviderContext) => T;
}

export interface ProviderContext {
  /** Resolve another (already-active) capability's single active instance. */
  query<T>(capability: CapabilityId): T;
  kernelVersion: string;
}
