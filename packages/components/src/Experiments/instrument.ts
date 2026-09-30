import type { Reading, TopicPayload } from "@ksp-gonogo/sitrep-sdk";

/**
 * One science instrument aboard the active vessel: the widget's parsed shape and
 * the row component's prop.
 * Already normalised to plain booleans. `partId` is a string even where the wire
 * sends a number, because every consumer uses it as a key or command argument.
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

/**
 * An instrument contributed to `experiments.instruments`, with the reading its
 * flags were read from so the row can be marked held.
 */
export interface ContributedInstrument extends Instrument {
  reading: Reading<unknown>;
}

// Asserted against `Instrument` in `instrument.test-d.ts`.
export type WireInstrument = TopicPayload<"science.instruments">[number];

/**
 * `experiments.instruments`: instruments this widget cannot observe itself, because
 * `science.instruments` is the stock experiment list and a mod running its own
 * science module never appears there. Mirrored in `mod/sitrep-sdk/src/api/contribution-slots.ts` as
 * `ExperimentsInstrumentEntry`.
 */
declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "experiments.instruments": {
      entry: ContributedInstrument;
    };
  }
}
