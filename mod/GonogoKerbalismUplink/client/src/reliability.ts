// This Uplink's namespace of reliability.summary's provider extension bag: the
// typed half, which is deliberately NOT in core.
//
// `reliability.*` is a Kernel-elected capability, so its payload is a single shared
// shape core declares and whichever backend won the election fills. Core's generated
// `ReliabilitySummary.extensions` is opaque by construction (`ProviderExtensions` =
// a record of `unknown`): core cannot know a provider's shape, and a generated type
// that pretended to would be the closed-enum mistake the open `SitrepUnit` union
// already refused once. So the type lives HERE, in the package that also writes the
// sub-tree server-side, mirroring how an augment slot's filler "is always part of
// its OWN package's compiled program".
//
// A consuming widget therefore imports `readKerbalismReliabilityExt` from this
// package rather than reaching into `summary.extensions?.kerbalism` and casting at
// the call site. That is the whole boundary: core stays open and opaque, the
// provider supplies the type at its own edge.

import {
  PROVIDER_EXTENSIONS_FIELD,
  type ReliabilitySummary,
  registerProviderExtensionShape,
} from "@ksp-gonogo/sitrep-sdk";
import type { KerbalismReliabilityExt } from "./__generated__/contract";
// Side-effect import: `topics.ts` feeds this Uplink's generated TYPE unit/shape
// maps into the SDK's type-keyed registry, which is what `registerProviderExtensionShape`
// below resolves `"KerbalismReliabilityExt"` through. Imported here, not just from
// the package entry, so the two halves cannot come apart for a consumer that reaches
// this module directly.
import "./topics";

export type { KerbalismReliabilityExt };

/**
 * The Kernel provider id this Uplink's reliability backend registers under, and so
 * the key its namespace lives at. Must match `KerbalismReliabilityMap.ProviderId`
 * in the C#; `reliability.test.ts` pins the two together.
 */
export const KERBALISM_RELIABILITY_PROVIDER_ID = "kerbalism";

/** The core Topic whose payload carries the namespace. */
export const RELIABILITY_SUMMARY_TOPIC = "reliability.summary";

/**
 * The generated interface name the namespace holds. A string because that is how
 * the SDK's type-keyed unit registry is addressed, the same way
 * `registerTypeUnits` already is.
 */
const KERBALISM_RELIABILITY_EXT_TYPE = "KerbalismReliabilityExt";

// The RUNTIME half, and it is not optional: without it every quantity in the
// namespace arrives as a bare number while ./__generated__/contract.ts still types
// it `Value<"h">`/`Value<"count">`. `wrapTopicPayload` walks a payload's declared
// shapes from the GENERATED maps, and no generated map can name a provider's
// sub-tree of a core payload, so the bag is routed through its own registry
// instead. `reliability.test.ts` proves it at decode time through a real
// TelemetryClient, and proves it non-vacuously by going red when this call is
// removed.
registerProviderExtensionShape(
  RELIABILITY_SUMMARY_TOPIC,
  KERBALISM_RELIABILITY_PROVIDER_ID,
  KERBALISM_RELIABILITY_EXT_TYPE,
);

/**
 * Narrow `reliability.summary`'s extension bag to this Uplink's own typed shape.
 *
 * Returns `undefined` when Kerbalism is not the elected backend, when its coverage
 * is anything other than `modeled`, or when the vessel has no modelled parts: all
 * three cases omit the namespace at the source rather than sending an empty one, so
 * "absent" is the single answer to "Kerbalism has nothing to say here". Which of
 * the three it is, is on the shared summary's own `coverage` field.
 *
 * The cast at the end is the honest edge of the mechanism, not a gap in it: the
 * shape is owned at BOTH ends by this package (the C# `KerbalismReliabilityExt`
 * generates this TS type AND the wire keys the Uplink writes), and the golden
 * fixture both sides assert against is what keeps those two ends in agreement.
 * What is checked here is only what a consumer cannot assume: that a namespace is
 * present and is an object at all.
 */
export function readKerbalismReliabilityExt(
  summary: ReliabilitySummary | undefined | null,
): KerbalismReliabilityExt | undefined {
  const bag = summary?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === undefined || bag === null) return undefined;
  const namespaced = bag[KERBALISM_RELIABILITY_PROVIDER_ID];
  if (namespaced === null || typeof namespaced !== "object") return undefined;
  return namespaced as KerbalismReliabilityExt;
}
