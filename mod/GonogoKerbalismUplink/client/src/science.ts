// This Uplink's namespaces of the four elected `science.*` payloads' provider
// extension bags: the typed half, which is deliberately NOT in core.
//
// `science.*` is a Kernel-elected capability, so each channel is a single shared
// shape core declares and whichever backend won the election fills. Kerbalism WINS
// that election when installed, and most of what it knows has no stock field to land
// in: drive capacity, file-vs-sample, the reason an experiment is not running, a
// per-subject ledger, a continuous transmit rate. Core's generated `extensions` is
// opaque by construction (`ProviderExtensions` = a record of `unknown`), because a
// generated type that pretended to know a provider's shape would be the closed-enum
// mistake the open `SitrepUnit` union already refused once. So the types live HERE,
// in the package that also writes the sub-trees server-side.
//
// A consuming widget therefore imports the readers below rather than reaching into
// `entry.extensions?.kerbalism` and casting at the call site. That is the whole
// boundary: core stays open and opaque, the provider supplies the type at its own
// edge.
//
// ── Read this before using a shared field on a Kerbalism-sourced science frame ──
// Kerbalism leaves several core fields NULL because its model does not fit their
// declared unit or meaning, and the entry's `valueModel` tag is what says so:
// `dataAmount`/`dataStored`/`dataStorage`/`dataMits` (mits, Kerbalism has megabytes,
// see `dataSizeMB` here), `baseTransmitValue`/`transmitBonus` (Kerbalism's
// stock-interop bridge hardcodes them; see `sciencePerMB`), `scienceRate`/
// `storedScience` on a lab (Kerbalism's lab makes files, not science; see
// `effectiveRateMBps`). Those nulls are structural, not "nothing yet".

import {
  type ExperimentBreakdownEntry,
  type ExperimentEntry,
  type InstrumentEntry,
  type LabEntry,
  PROVIDER_EXTENSIONS_FIELD,
  registerProviderExtensionShape,
  registerUnit,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  KerbalismScienceBreakdownExt,
  KerbalismScienceExperimentExt,
  KerbalismScienceInstrumentExt,
  KerbalismScienceLabExt,
} from "./__generated__/contract";
// Side-effect import: `topics.ts` feeds this Uplink's generated TYPE unit/shape
// maps into the SDK's type-keyed registry, which is what the
// `registerProviderExtensionShape` calls below resolve their type names through.
// Imported here, not just from the package entry, so the two halves cannot come
// apart for a consumer that reaches this module directly.
import "./topics";

export type {
  KerbalismScienceBreakdownExt,
  KerbalismScienceExperimentExt,
  KerbalismScienceInstrumentExt,
  KerbalismScienceLabExt,
};

/**
 * The Kernel provider id this Uplink's science backend registers under, and so the
 * key its namespaces live at. Must match `KerbalismScienceMap.ProviderId` in the
 * C#; `science.test.ts` pins the two together.
 */
export const KERBALISM_SCIENCE_PROVIDER_ID = "kerbalism";

/**
 * The `valueModel` tag Kerbalism-sourced value-bearing science entries carry. A
 * consumer comparing science numbers across providers checks this first: Kerbalism's
 * value is linear per megabyte, stock's is a diminishing-returns curve, and the two
 * are not the same quantity wearing different units.
 */
export const KERBALISM_SCIENCE_VALUE_MODEL = "kerbalism-linear";

/** The core Topics whose payloads carry the namespaces. */
export const SCIENCE_EXPERIMENTS_TOPIC = "science.experiments";
export const SCIENCE_INSTRUMENTS_TOPIC = "science.instruments";
export const SCIENCE_LAB_TOPIC = "science.lab";
export const SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC = "science.experimentBreakdown";

// ── The three units this Uplink brings with it ──────────────────────────────
// Kerbalism measures science data in megabytes, not stock's mits, and none of the
// three symbols below is in the first-party catalog. `registerUnit` is the declared
// extension point for exactly this: a symbol with no dimension can be carried but
// never wrapped (`wrapTopicPayload` skips a token the model does not know, treating
// it as a non-quantity), so without these calls every `MB` figure in a namespace
// would arrive as a bare number while the generated type still said `Value<"MB">`.
//
// Dimensioned onto the model's real `bit`, not given a private dimension of its own:
// that is what makes a Kerbalism file size commensurable with an antenna's `bit/s`
// budget instead of being an island. 1 MB = 8e6 bit (SI mega, decimal), matching how
// the catalog already scales `Mbit/s`. Mits deliberately stay their own dimension in
// the first-party catalog, because a mit is a game abstraction with no byte count,
// which is the whole reason the two cannot share a field.
registerUnit({ symbol: "MB", kind: "data", dimension: { bit: 1 }, ratio: 8e6 });
registerUnit({
  symbol: "MB/s",
  kind: "dataRate",
  dimension: { bit: 1, s: -1 },
  ratio: 8e6,
});
registerUnit({
  symbol: "science/MB",
  kind: "scienceDensity",
  dimension: { science: 1, bit: -1 },
  ratio: 1 / 8e6,
});

// The RUNTIME half, and it is not optional: without it every quantity in a
// namespace arrives as a bare number while ./__generated__/contract.ts still types
// it `Value<"MB">`/`Value<"MB/s">`/`Value<"count">`. `wrapTopicPayload` walks a
// payload's declared shapes from the GENERATED maps, and no generated map can name
// a provider's sub-tree of a core payload, so the bags are routed through their own
// registry instead. `science.test.ts` proves it at decode time through a real
// TelemetryClient, and proves it non-vacuously by going red when a call is removed.
//
// Keyed by TOPIC rather than by the entry type name: these are array Topics, and
// `wrapTopicPayload` recurses into an array's elements carrying the TOPIC as the
// owner (an array Topic's declared units describe its element), so the topic id is
// the owner a per-entry bag is reachable under.
registerProviderExtensionShape(
  SCIENCE_EXPERIMENTS_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceExperimentExt",
);
registerProviderExtensionShape(
  SCIENCE_INSTRUMENTS_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceInstrumentExt",
);
registerProviderExtensionShape(
  SCIENCE_LAB_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceLabExt",
);
registerProviderExtensionShape(
  SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceBreakdownExt",
);

/**
 * Narrow one payload's extension bag to this Uplink's own typed shape.
 *
 * The cast is the honest edge of the mechanism, not a gap in it: the shape is owned
 * at BOTH ends by this package (the C# `KerbalismScience*Ext` generates the TS type
 * AND the wire keys the map writes), and the golden fixture both sides assert
 * against is what keeps those two ends in agreement. What is checked here is only
 * what a consumer cannot assume: that a namespace is present and is an object.
 */
function read<T>(
  payload: { [PROVIDER_EXTENSIONS_FIELD]?: unknown } | undefined | null,
): T | undefined {
  const bag = payload?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === undefined || bag === null || typeof bag !== "object") {
    return undefined;
  }
  const namespaced = (bag as Record<string, unknown>)[
    KERBALISM_SCIENCE_PROVIDER_ID
  ];
  if (namespaced === null || typeof namespaced !== "object") return undefined;
  return namespaced as T;
}

/**
 * Kerbalism's namespace of one `science.experiments` entry: the stored result as it
 * actually exists, on a drive, sized in megabytes, file or sample.
 *
 * Returns `undefined` when Kerbalism is not the elected backend (a stock frame
 * carries no namespace at all), which is the single answer to "Kerbalism has
 * nothing to say here".
 */
export function readKerbalismScienceExperimentExt(
  entry: ExperimentEntry | undefined | null,
): KerbalismScienceExperimentExt | undefined {
  return read<KerbalismScienceExperimentExt>(entry);
}

/**
 * Kerbalism's namespace of one `science.instruments` entry: the running-state
 * machine and, when something is in the way, its reason. This is the one an
 * operator wants most, because "why is my experiment not running" has no answer at
 * all in stock's flat deployed/inoperable pair.
 */
export function readKerbalismScienceInstrumentExt(
  entry: InstrumentEntry | undefined | null,
): KerbalismScienceInstrumentExt | undefined {
  return read<KerbalismScienceInstrumentExt>(entry);
}

/**
 * Kerbalism's namespace of one `science.lab` entry: the analysis rate in MB/s and
 * the typed status. Note the lab is an intermediate stage under Kerbalism (a sample
 * becomes a transmissible file, which still has to be sent), which is why the
 * shared `scienceRate` is null on these frames.
 */
export function readKerbalismScienceLabExt(
  entry: LabEntry | undefined | null,
): KerbalismScienceLabExt | undefined {
  return read<KerbalismScienceLabExt>(entry);
}

/**
 * Kerbalism's namespace of one `science.experimentBreakdown` entry: the full
 * per-subject ledger (retrieved vs in-flight, times completed) that core's two
 * snapshot fields are a lossy view of.
 */
export function readKerbalismScienceBreakdownExt(
  entry: ExperimentBreakdownEntry | undefined | null,
): KerbalismScienceBreakdownExt | undefined {
  return read<KerbalismScienceBreakdownExt>(entry);
}
