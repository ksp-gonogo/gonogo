/**
 * Per file, how many primitives are fed a figure that CAME from a reading with
 * the currency dropped on the way: `value("funds", careerFunds)` where the
 * funds were read, `career?.balances?.funds` reached off a payload, or a
 * `describeReckonable(reading)` helper that hands back bare values.
 *
 * Derived from the walk rather than typed out, so the total lives in the list
 * below rather than in this sentence. It is a CEILING and an exact one,
 * because unlike the act-warning counts this number comes from a deterministic
 * static walk rather than from a race, so a file that drops below its entry
 * can and must tighten it in the same commit. An approximate ceiling on an
 * exact measurement is just a place to hide.
 *
 * Three different fixes, which is why this is a survey rather than a task:
 * a minted `Value` goes through `combineReadings`, a payload field moves onto
 * the field property, and a laundering helper has to return readings itself.
 * Which of them each site wants is a scheduling decision; what this list does
 * is stop the number growing while that decision is open.
 *
 * A cleared entry is only as strong as the walk's reach, so when the walk is
 * widened, the files already cleared are where to look first. The walk follows
 * a figure's provenance within what the compiler can resolve, so splitting a
 * widget can sever the chain and lower a file's count with nothing fixed:
 * `primitive-reading-feed.test.ts` grades each widget directory's total against
 * the ratchet base for that reason (see `debt-split-guard.ts`).
 */
export const DERIVED_FEED_DEBT: Record<string, number> = {
  // A comms figure nulls when the link stops arriving rather than drawing held, so these read the observation alone.
  "packages/components/src/CommSignal/CommSignalView.tsx": 1,
};
