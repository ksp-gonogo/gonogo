/**
 * Sites where a `Reading` is still used as a truthiness or nullish gate, i.e.
 * a gate that no longer gates. SHRINK-ONLY: see
 * `styleguide-reading-gates.test.ts` for what the scan can and cannot see.
 *
 * Every line here is a site the `useTelemetry` migration has not reached yet.
 * It is not a permitted pattern and there is no permanent bucket: the correct
 * fix is always to branch on `state`, and the list exists so the sweep can
 * proceed widget by widget without the un-migrated remainder going unrecorded.
 *
 * **A line may only be removed, never added.** Adding one means writing a new
 * gate that does not gate.
 */
export const READING_GATE_DEBT: readonly string[] = [
  /*
   * Same site, thirty-six lines lower: the probe harness learned install
   * profiles above it. Renumbered, not fixed: the fix is `state !== "pending"`
   * (`AugmentAvailabilityFeeder` already made it), and making it here changes
   * which augments the probe renders, which moves the visual baselines.
   */
  "packages/components/scripts/probe/probe-entry.tsx:338",
];
