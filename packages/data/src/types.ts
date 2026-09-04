// The flight-record and series types live in `@ksp-gonogo/sitrep-sdk` with
// `BufferedDataSource`, whose closure they belong to.
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
  SeriesReckonedSpan,
  SeriesStatusSpan,
  SeriesTimeBasis,
  UnitHint,
  UnitHint as Unit,
} from "@ksp-gonogo/sitrep-sdk";
