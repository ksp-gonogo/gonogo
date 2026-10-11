#!/usr/bin/env tsx
/**
 * Render gate: every widget, at its real tile size, through the harness's
 * detectors in a job that is expected green.
 *
 * One pass answers every question the harness asks of a laid-out widget: does
 * a widget paint two of its own sections into the same pixels, does any glyph
 * fall back from JetBrains Mono, is anything clipped out of reach, does a tiny
 * form fit its real figures, does axe find a violation. The detectors run on
 * every render whichever finding a caller cares about, so two scripts over the
 * same pass would only render everything twice.
 *
 * The harness's other callers are `render-widget`, which a person invokes by
 * hand, and the `visual` job, which is red on purpose and therefore shows the
 * colour it always shows whatever the harness reports. A finding that only
 * lands there is a finding nobody sees.
 *
 * Fixed-tile deliberately, never the review path's full-content capture. That
 * path grows the box until nothing is clipped, which hands a squeezed flex item
 * the room it was missing and makes the overlap disappear. The geometry an
 * operator gets is the tile.
 *
 * Chromium only: geometry is where engines disagree, and
 * `CSS.getPlatformFontsForNode` is a DevTools Protocol call with no firefox or
 * webkit equivalent.
 *
 * Writes no pictures: the gate judges the DOM and discards the PNGs.
 */
import { scopeWidgets, shardFlag, widgetFlag } from "./gateScope";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

/**
 * Below this, the gate is not surveying the widget set, it is iterating over
 * whatever survived. A version of this check that reports success having
 * rendered nothing presents identically to a clean tree.
 */
const MIN_WIDGETS = 30;

async function main(): Promise<void> {
  const { widgets, refusal } = scopeWidgets(
    listWidgets(),
    widgetFlag(process.argv.slice(2)),
    "render-gate",
    MIN_WIDGETS,
    shardFlag(process.argv.slice(2)),
  );
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  console.log(`render-gate: ${widgets.length} widgets at tile size`);
  await renderWidgets([...widgets], {
    capture: false,
    concurrency: Number(process.env.RENDER_GATE_PAGES ?? 4),
  });
  console.log(
    "\nrender-gate: no widget stacks two sections into one place or draws a glyph outside JetBrains Mono.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
