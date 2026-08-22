// RealAntennas' namespace of CommsHop's provider extension bag: the typed half,
// deliberately NOT in core.
//
// `comms.path` is a core-elected channel whose shared `CommsHop` shape is filled
// by whichever backend won the "comms" capability. Core's generated
// `CommsHop.extensions` is opaque by construction (`ProviderExtensions` = a record
// of `unknown`): core cannot know a provider's shape. So the type lives HERE, in
// the package that also writes the sub-tree server-side (RaHopExtensions.cs),
// mirroring how an augment slot's filler "is always part of its OWN package's
// compiled program".
//
// A consuming widget imports `readRealAntennasHopExt` from this package rather than
// reaching into `hop.extensions?.realantennas` and casting at the call site.

import {
  type CommsHop,
  PROVIDER_EXTENSIONS_FIELD,
  registerProviderExtensionShape,
} from "@ksp-gonogo/sitrep-sdk";
import type { RealAntennasHopExt } from "./__generated__/contract";
// Side-effect import: `topics.ts` feeds this Uplink's generated TYPE unit/shape
// maps into the SDK's type-keyed registry, which is what
// `registerProviderExtensionShape` below resolves `"RealAntennasHopExt"` through.
// Imported here, not just from the package entry, so the two halves cannot come
// apart for a consumer that reaches this module directly.
import "./topics";

export type { RealAntennasHopExt };

/**
 * The Kernel provider id the RA comms backend registers under, and so the key its
 * namespace lives at. Must match `RaHopExtensions.ProviderId` (= `RaCommsBackend.Id`)
 * in the C#; `hopExt.test.ts` pins the two together.
 */
export const REALANTENNAS_PROVIDER_ID = "realantennas";

/**
 * The OWNER the bag is registered against: the generated interface name of the
 * NESTED shape carrying it, since `CommsHop` is reached through `comms.path`'s
 * `hops` array rather than being a Topic of its own. `wrapTopicPayload` walks
 * `comms.path -> hops[] -> CommsHop`, and at each element resolves this owner to
 * hydrate the RA namespace's quantities.
 */
const COMMS_HOP_TYPE = "CommsHop";

/** The generated interface name the namespace holds. */
const REALANTENNAS_HOP_EXT_TYPE = "RealAntennasHopExt";

// The RUNTIME half, and it is not optional: without it every quantity in the
// namespace (required Eb/N0 in dB, beamwidth in degrees, the reverse rate in
// bit/s, the EC draw in units/s) arrives as a bare number while
// ./__generated__/contract.ts still types it `Value<...>`. `wrapTopicPayload`
// walks a payload's declared shapes from the GENERATED maps, and no generated map
// can name a provider's sub-tree of a core payload, so the bag is routed through
// its own registry instead. `hopExt.test.ts` proves it at decode time through a
// real TelemetryClient.
registerProviderExtensionShape(
  COMMS_HOP_TYPE,
  REALANTENNAS_PROVIDER_ID,
  REALANTENNAS_HOP_EXT_TYPE,
);

/**
 * Narrow one `CommsHop`'s extension bag to RealAntennas' own typed shape, or
 * `undefined` when RA is not the elected backend (bare CommNet leaves the whole
 * bag off) or the hop carried no RA namespace.
 *
 * The cast at the end is the honest edge of the mechanism: the shape is owned at
 * BOTH ends by this package (the C# `RealAntennasHopExt` generates this TS type AND
 * the wire keys `RaHopExtensions` writes), kept in agreement by the golden fixture
 * both sides assert against. What is checked here is only what a consumer cannot
 * assume: that a namespace is present and is an object at all.
 */
export function readRealAntennasHopExt(
  hop: CommsHop | undefined | null,
): RealAntennasHopExt | undefined {
  const bag = hop?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === undefined || bag === null) return undefined;
  const namespaced = bag[REALANTENNAS_PROVIDER_ID];
  if (namespaced === null || typeof namespaced !== "object") return undefined;
  return namespaced as RealAntennasHopExt;
}
