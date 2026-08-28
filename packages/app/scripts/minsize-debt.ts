/**
 * Widgets that do not fit the minimum size they themselves declare.
 * **This list may only ever SHRINK.**
 *
 * A `minSize` is a promise: react-grid-layout refuses to drag a tile below it
 * and a saved layout smaller than it is clamped up, so it is the smallest shape
 * an operator can ever put the widget in. Nothing checked the promise until
 * `minsize-gate.ts`, and the first full sweep found NINETEEN of 55 failing it.
 *
 * Seeded 2026-08-28 from that sweep, at the sizes each widget declares:
 *
 *  - 16 ellipsise a HEADING, so the widget cannot name itself. Programme
 *    Funding loses 102px of "PROGRAMME FUNDING", Avionics Control 94px
 *  - 6 clip content with nothing to scroll. Aerodynamics hides 264px of readouts
 *    behind an `overflow: hidden`, which is not reachable by scrolling, by
 *    resizing within the minimum, or by any other means
 *
 * The worst two are Uplink-authored (Aerodynamics is the FAR Uplink, Avionics
 * Control the Avionics one), which is the reason the affordance they were
 * missing went into the PUBLISHED `@ksp-gonogo/ui-kit` rather than into the app.
 *
 * Seeded rather than left red, because this repo already owns one permanently
 * red job and has twice had a real failure hide behind it. A widget NOT listed
 * here is held to fitting, so anything authored from now on fits from the day it
 * lands and only what was already broken is grandfathered.
 *
 * `minsize-gate.ts` holds the list from both sides:
 *
 *  - a widget that misfits and is NOT listed fails, which is the regression the
 *    gate exists for
 *  - a listed widget that now FITS also fails, so a fix forces its entry out
 *    rather than leaving a permission behind
 *
 * The value is the finding KINDS, sorted and comma-joined, rather than a count.
 * There are only three of them, so the value is stable in a way a per-element
 * count is not: one wrapped row can turn four cut-off labels into six without
 * anything having changed about the defect.
 *
 * The two ways OUT of this list are both legitimate and the gate does not care
 * which you pick:
 *
 *  - make the widget fit: a shorter title at narrow widths, a scroller for
 *    content that overflows
 *  - RAISE its `minSize`, when the honest answer is that the widget cannot be
 *    that small. Say so in the commit
 */
export const KNOWN_MISFITS: Record<string, string> = {
  "action-group": "title-clipped",
  "aero-state": "text-cut-off, title-clipped",
  "astronaut-complex": "title-clipped",
  "avionics-go-no-go": "text-cut-off, title-clipped",
  "camera-feed": "text-cut-off, title-clipped",
  "career-economy": "title-clipped",
  "contract-manager": "title-clipped",
  "deployed-science": "title-clipped",
  experiments: "title-clipped",
  "input-tester": "title-clipped",
  "kos-script-trigger": "text-cut-off",
  "kos-terminal": "text-cut-off",
  "launch-director": "title-clipped",
  "power-systems": "title-clipped",
  "resource-ops": "title-clipped",
  "space-center-status": "text-cut-off",
  "space-weather": "title-clipped",
  strategies: "title-clipped",
  "tech-tree": "title-clipped",
};
