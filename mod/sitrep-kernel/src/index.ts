/**
 * Public surface of the Sitrep capability kernel.
 *
 * Kept deliberately narrow: the kernel class + resolve() options/result
 * shapes, the capability/provider type vocabulary, and the three fail-loud
 * error classes. The `proof/` directory (the courier-vs-vanilla comms demo)
 * is internal to this package's test suite, not part of the public surface.
 */

export const KERNEL_VERSION = "0.0.0";

export type {
  CapabilityDescriptor,
  CapabilityId,
  ProviderContext,
  ProviderRegistration,
  ProviderVersions,
} from "./capability";
export {
  AmbiguousResolutionError,
  DependencyCycleError,
  SpineCapabilityUnsatisfiedError,
} from "./errors";
export type { ResolutionNotice, ResolveOptions } from "./registry";
export { Kernel } from "./registry";
export type { VersionRange } from "./version";
