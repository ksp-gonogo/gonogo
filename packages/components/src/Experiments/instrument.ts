import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";

/**
 * One science instrument aboard the active vessel: the widget's own parsed
 * shape, the row component's prop, AND the `experiments.instruments`
 * contribution entry, which are the same thing described three ways and so are
 * one type here.
 *
 * Presentational and already-normalised (plain booleans, not the wire's
 * optionals), so nothing downstream has to guess what a missing flag meant.
 * This is the widget-facing projection of the SDK's `InstrumentEntry`
 * (`science.instruments`), *not* `ExperimentEntry` (`science.experiments`): a
 * row needs `partId`/`hasData`/`rerunnable`, fields `ExperimentEntry` does not
 * carry. `partId` is a string even where the wire sends a number, which is safe
 * because every consumer interpolates it into a key or a command argument and
 * none compares it numerically.
 */
export interface Instrument {
  partId: string;
  partTitle: string;
  expId: string;
  deployed: boolean;
  /** The instrument currently holds collectable data. */
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

// Compile-time linkage to the SDK wire type (type-only; keeps the SDK
// dependency real without a runtime edge). `InstrumentEntry`'s fields are
// optional (wire uncertainty); `Instrument` is the normalised, already-parsed
// shape `parseInstruments` produces. Asserted in `instrument.test-d.ts`.
export type WireInstrument = TopicPayload<"science.instruments">[number];

/**
 * `experiments.instruments`: instruments aboard that this widget cannot observe
 * for itself, because `science.instruments` is the STOCK experiment list and a
 * mod running its own experiment parts through its own science module never
 * appears there. Without the slot they are invisible to the one widget whose
 * whole subject is what science hardware is aboard.
 *
 * A CONTRIBUTION rather than an augment, because what is missing is DATA and
 * not chrome: the widget already knows how to draw an instrument row, group it
 * by experiment, count it in the header totals and match it against the filter,
 * and a contributor that rendered its own rows would get none of that. The
 * augment it replaces could only reach the header's `actions` segment, so it
 * shipped a count badge that opened a floating list clipped by the panel it
 * rendered inside.
 *
 * Declares no `topics`: a contributor here brings its own, and naming a
 * mod-owned id in a published slot is what the registry's own header warns
 * against. Mirrored in `mod/sitrep-sdk/src/api/contribution-slots.ts` as
 * `ExperimentsInstrumentEntry`, kept honest by
 * `contribution-slot-registry.conformance.test-d.ts`.
 */
declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "experiments.instruments": {
      entry: Instrument;
    };
  }
}
