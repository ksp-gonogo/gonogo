/**
 * Widgets that do not fit the minimum size they themselves declare.
 * **This list may only ever SHRINK.**
 *
 * A `minSize` is a promise: react-grid-layout refuses to drag a tile below it
 * and a saved layout smaller than it is clamped up, so it is the smallest shape
 * an operator can ever put the widget in. Nothing checked the promise until
 * `minsize-gate.ts`, and the first full sweep found NINETEEN of 55 failing it:
 * 16 ellipsising a heading, Programme Funding losing 102px of its own name, and
 * 6 clipping content with nothing to scroll, Aerodynamics hiding 264px of
 * readouts behind an `overflow: hidden`.
 *
 * The worst two are Uplink-authored (Aerodynamics is the FAR Uplink, Avionics
 * Control the Avionics one), which is why the affordance they were missing went
 * into the PUBLISHED `@ksp-gonogo/ui-kit` rather than into the app.
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
 *  - make the widget fit: `<Panel compactTitle={["RES OPS", "RES"]}>` for a
 *    heading that will not, a scroller for content that overflows, and a line
 *    that is allowed to WRAP for a sentence
 *  - RAISE its `minSize`, when the honest answer is that the widget cannot be
 *    that small. Say so in the commit
 */
export const KNOWN_MISFITS: Record<string, string> = {
  "aero-state": "text-cut-off",
  "avionics-go-no-go": "text-cut-off",
  "camera-feed": "text-cut-off, title-clipped",
  "input-tester": "text-cut-off",
  "kos-script-trigger": "text-cut-off",
  "science-data": "text-cut-off",
  "space-center-status": "text-cut-off",
};
