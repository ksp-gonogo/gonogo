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
 * An {@link Instrument} with the experiment's display title where the wire
 * carries one. A separate type because `Instrument` is mirrored in the SDK's
 * published slot types; the card falls back to `expId` without a title.
 */
export interface TitledInstrument extends Instrument {
  expTitle?: string;
  /** False where the wire did not say whether the instrument holds data, so `hasData` is a default rather than a reading. */
  dataKnown?: boolean;
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
