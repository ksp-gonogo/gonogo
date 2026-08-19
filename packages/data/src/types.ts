import type { TelemaachusSchema } from "@ksp-gonogo/core";

// ---------------------------------------------------------------------------
// DataSourceRegistry extension: declaration-merged so the two-arg legacy
// `('data', key)` read/status/series overloads stay strongly typed. The schema
// starts as a passthrough of the wrapped telemachus schema; as derived keys
// land (Phase 2), they extend this type.
// ---------------------------------------------------------------------------

declare module "@ksp-gonogo/core" {
  interface DataSourceRegistry {
    data: TelemaachusSchema;
  }
}

// The flight-record and series types moved to `@ksp-gonogo/sitrep-sdk` with
// `BufferedDataSource`, whose closure they belong to. The `declare module` block
// above did NOT move: it is a side-effect registration against a private package
// that no file in that closure consumes, so it was stored alongside those types
// rather than depended on by them.
//
// Re-exported so this package's importers keep their import site.
// `Unit` here is the units HINT (a string union: "m" | "km" | ...), not ui-kit's
// `Unit` renderer component. It is named `UnitHint` in the sdk to keep the two
// apart on the published surface; this alias keeps the local import site.
export type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightCrashOutcome,
  FlightOutcome,
  FlightRecord,
  FlightRecoveryOutcome,
  Sample,
  SeriesRange,
  UnitHint,
  UnitHint as Unit,
} from "@ksp-gonogo/sitrep-sdk";
