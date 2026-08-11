// This Uplink's namespaces of the two elected `isru.*` payloads' provider extension
// bags: the typed half, which is deliberately NOT in core.
//
// `isru.*` is a Kernel-elected capability, so each channel is a single shared shape
// core declares and whichever backend won the election fills. Kerbalism WINS that
// election when installed, because its own patches delete stock's harvester and
// converter modules outright: on a Kerbalism install the stock reader walks a vessel
// and finds nothing.
//
// Unlike this Uplink's science bags, most of what Kerbalism's ISRU knows DOES have a
// stock counterpart, so the shared shape carries it and these two namespaces are
// small. Every SHARED field is filled on a Kerbalism frame, with no structural nulls
// and no value-model caveat: a Kerbalism drill's rate is in the same resource units a
// stock drill's is. What is here is only what stock has no concept of.
//
// A consuming widget imports the readers below rather than reaching into
// `entry.extensions?.kerbalism` and casting at the call site. That is the whole
// boundary: core stays open and opaque, the provider supplies the type at its own
// edge.
//
// ── One thing to know about the converter list under Kerbalism ──────────────
// Kerbalism does not distinguish an ISRU process from a life-support one: a scrubber,
// a water recycler and a Molten Regolith Electrolysis plant are the same
// `ProcessController` module running different chemistry. So `isru.converters` carries
// ALL of them, which is more rows than a stock frame has, and the same part also
// appears on `kerbalism.lifesupport`. Those are two honest views of one set of parts
// (this one the per-part converter chemistry, that one the supply and consumption
// picture), not two separate systems. Filtering here would mean gonogo asserting a
// taxonomy the engine does not draw.

import {
  type IsruConverterEntry,
  type IsruDrillEntry,
  PROVIDER_EXTENSIONS_FIELD,
  registerProviderExtensionShape,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  KerbalismIsruConverterExtension,
  KerbalismIsruDrillExtension,
} from "./__generated__/contract";
// Side-effect import: `topics.ts` feeds this Uplink's generated TYPE unit/shape maps
// into the SDK's type-keyed registry, which is what the
// `registerProviderExtensionShape` calls below resolve their type names through.
// Imported here, not just from the package entry, so the two halves cannot come apart
// for a consumer that reaches this module directly.
import "./topics";

export type { KerbalismIsruConverterExtension, KerbalismIsruDrillExtension };

/**
 * The Kernel provider id this Uplink's ISRU backend registers under, and so the key
 * its namespaces live at. Must match `KerbalismIsruMap.ProviderId` in the C#;
 * `isru.test.ts` pins the two together.
 */
export const KERBALISM_ISRU_PROVIDER_ID = "kerbalism";

/** The core Topics whose payloads carry the namespaces. */
export const ISRU_DRILLS_TOPIC = "isru.drills";
export const ISRU_CONVERTERS_TOPIC = "isru.converters";

// The RUNTIME half, and it is not optional: without it every quantity in a namespace
// arrives as a bare number while ./__generated__/contract.ts still types it
// `Value<"units/s">`/`Value<"t">`/`Value<"units">`/`Value<"count">`.
// `wrapTopicPayload` walks a payload's declared shapes from the GENERATED maps, and no
// generated map can name a provider's sub-tree of a core payload, so the bags are
// routed through their own registry instead. `isru.test.ts` proves it at decode time
// through a real TelemetryClient, and proves it non-vacuously by going red when a call
// is removed.
//
// This bag needs NO `registerUnit` call, unlike the science bags: every unit here is
// already in the first-party catalog, because Kerbalism measures ISRU in the same
// resource units the game does. The shape registration below is still load-bearing on
// its own.
//
// Keyed by TOPIC rather than by the entry type name: these are array Topics, and
// `wrapTopicPayload` recurses into an array's elements carrying the TOPIC as the owner
// (an array Topic's declared units describe its element), so the topic id is the owner
// a per-entry bag is reachable under.
registerProviderExtensionShape(
  ISRU_DRILLS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  "KerbalismIsruDrillExtension",
);
registerProviderExtensionShape(
  ISRU_CONVERTERS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  "KerbalismIsruConverterExtension",
);

/**
 * Narrow one payload's extension bag to this Uplink's own typed shape.
 *
 * The cast is the honest edge of the mechanism, not a gap in it: the shape is owned at
 * BOTH ends by this package (the C# `KerbalismIsru*Extension` generates the TS type AND
 * the wire keys the map writes), and the golden fixture both sides assert against is
 * what keeps those two ends in agreement. What is checked here is only what a consumer
 * cannot assume: that a namespace is present and is an object.
 */
function read<T>(
  payload: { [PROVIDER_EXTENSIONS_FIELD]?: unknown } | undefined | null,
): T | undefined {
  const bag = payload?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === undefined || bag === null || typeof bag !== "object") {
    return undefined;
  }
  const namespaced = (bag as Record<string, unknown>)[
    KERBALISM_ISRU_PROVIDER_ID
  ];
  if (namespaced === null || typeof namespaced !== "object") return undefined;
  return namespaced as T;
}

/**
 * Kerbalism's namespace of one `isru.drills` entry: the blocking reason, the EC draw,
 * and the asteroid/comet depletion state.
 *
 * `issue` is the one an operator wants most, because "why is Ore production zero" has
 * no answer at all in stock, where a drill that cannot extract simply switches itself
 * off. It is absent when nothing is wrong, which is the normal case, so render it only
 * when it is there.
 *
 * Returns `undefined` when Kerbalism is not the elected backend (a stock frame carries
 * no namespace at all), which is the single answer to "Kerbalism has nothing to say
 * here".
 */
export function readKerbalismIsruDrillExt(
  entry: IsruDrillEntry | undefined | null,
): KerbalismIsruDrillExtension | undefined {
  return read<KerbalismIsruDrillExtension>(entry);
}

/**
 * Kerbalism's namespace of one `isru.converters` entry: the `ProcessController`'s own
 * throttle state, which is what a Kerbalism converter actually is (a capacity that
 * throttles a decoupled recipe, rather than stock's part that IS its recipe).
 *
 * Note there is deliberately no blocking-reason field here. A starved Kerbalism recipe
 * clamps its rate to zero silently, so a reader derives that condition from the shared
 * shape (`running` true alongside zero rates) rather than from a string that would have
 * to be invented.
 */
export function readKerbalismIsruConverterExt(
  entry: IsruConverterEntry | undefined | null,
): KerbalismIsruConverterExtension | undefined {
  return read<KerbalismIsruConverterExtension>(entry);
}
