#!/usr/bin/env tsx
/**
 * Stacked-overlap gate: does any widget paint two of its own sections into the
 * same pixels?
 *
 * The detector itself lives in the render harness (`findOverlappingSections`),
 * so it already runs whenever anything renders. This script exists for WHERE it
 * runs, not for what it does. The harness's other callers are `render-widget`,
 * which a person invokes by hand, and the `visual` job, which is red on purpose
 * and therefore shows the colour it always shows whatever the harness reports.
 * A finding that only ever lands in those two places is a finding nobody sees,
 * which is how a dead probe bundle went unnoticed for a day and why
 * `probe-render-smoke` sits in the `test` job beside this.
 *
 * So: every widget, at its REAL tile size, in a job that is expected green.
 *
 * Fixed-tile deliberately, never the review path's full-content capture. That
 * path grows the box until nothing is clipped, which hands a squeezed flex item
 * the room it was missing and makes the overlap disappear. The geometry an
 * operator gets is the tile.
 *
 * Renders into a temp directory: the PNGs are a by-product here, and writing
 * them into `local_docs/renders/` would fight whatever a person is looking at.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

/**
 * Below this, the gate is not surveying the widget set, it is iterating over
 * whatever survived. A version of this check that reports success having
 * rendered nothing presents identically to a clean tree, which is the whole
 * failure mode the placement above is meant to close.
 */
const MIN_WIDGETS = 30;

async function main(): Promise<void> {
  const widgets = listWidgets();
  if (widgets.length < MIN_WIDGETS) {
    console.error(
      `\noverlap-gate: only ${widgets.length} widget config(s) found, expected at ` +
        `least ${MIN_WIDGETS}. Refusing to report a clean run over a set this small.`,
    );
    process.exit(1);
  }

  const outBase = await mkdtemp(join(tmpdir(), "gonogo-overlap-gate-"));
  console.log(
    `overlap-gate: ${widgets.length} widgets at tile size, renders → ${outBase}`,
  );
  try {
    await renderWidgets([...widgets], { outBase });
    console.log(
      "\noverlap-gate: no widget paints two sections into one place.",
    );
  } finally {
    await rm(outBase, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
