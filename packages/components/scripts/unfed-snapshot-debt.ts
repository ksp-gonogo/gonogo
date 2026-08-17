/**
 * Known un-fed snapshot debt. **This list may only ever SHRINK.**
 *
 * Each entry is a snapshot scenario whose committed baseline contains none of the
 * data its fixture emits: the render is the widget's empty state, whatever the
 * scenario is named after. They are recorded here rather than left as a permanently
 * red CI job, because a permanently red job stops being a signal and hides the next
 * unrelated failure behind it. The visual gate has been red since 10 August on the
 * "we will fix it shortly" reasoning, and that is the argument against repeating it.
 *
 * `unfed-snapshot-gate.ts` holds this list from both sides:
 *
 *  - a scenario that is un-fed and NOT listed here fails immediately, which is a
 *    new regression and the reason the gate exists
 *  - a scenario listed here that has become FED also fails, so fixing a widget
 *    forces its entries out rather than leaving a permission behind
 *
 * The count is the number of size modes for that scenario, so adding a mode to a
 * still-broken widget shows up rather than being absorbed silently.
 *
 * ## Why these are here
 *
 * Both widgets share one cause: a settle-check that waits for a stream-status badge
 * to CLEAR. That badge is the dashboard's, derived by the host from
 * `dataRequirements`, so under a bare widget harness it never renders at all and the
 * wait is satisfied on the first paint, before any emit. Both then snapshot the
 * un-emitted state.
 *
 * - `AtmosphereProfile`: six scenarios named after six different atmospheres, and
 *   all 48 renders are the string "ATMOSPHERE PROFILE Waiting for body telemetry..."
 * - `SpaceCenterStatus`: 48 more, whose every facility level is an em dash. A
 *   textual detector missed this one entirely, because its empty state is
 *   punctuation rather than a sentence
 *
 * Do NOT add an entry to make the gate green. An entry is an admission that a
 * committed baseline is wrong, and the only correct way to remove one is to fix the
 * harness so the render contains its data.
 */
export const KNOWN_UNFED: Record<string, number> = {
  "AtmosphereProfile/duna-thin-atmosphere": 8,
  "AtmosphereProfile/eve-thick-atmosphere": 8,
  "AtmosphereProfile/kerbin-reentry": 8,
  "AtmosphereProfile/kerbin-sea-level": 8,
  "AtmosphereProfile/kerbin-upper-atmosphere": 8,
  "AtmosphereProfile/mun-vacuum": 8,
  "SpaceCenterStatus/early-game-t1": 8,
  "SpaceCenterStatus/flight-scene-upgrades-disabled": 8,
  "SpaceCenterStatus/fully-upgraded-t3": 8,
  "SpaceCenterStatus/low-funds-expensive-upgrade": 8,
  "SpaceCenterStatus/mid-career-mixed": 8,
  "SpaceCenterStatus/sandbox-no-career": 8,
};
