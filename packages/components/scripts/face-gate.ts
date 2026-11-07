#!/usr/bin/env tsx
/**
 * Face gate: no change of a control's face moves anything else in its widget.
 *
 * Every scene of every widget is mounted at its largest tile, and each control
 * in it is pressed through the faces it can show (rest, armed, sent, answered,
 * refused, no reply; both states of a toggle; open and closed for an editor).
 * The box of every other element is read before and after each face and the
 * run fails on a move or a resize of even a pixel, naming the widget, scene,
 * control, face and the element that moved.
 *
 * Chromium by default; `--engine` takes the others.
 *
 *   face-gate                     # every widget
 *   face-gate --widget navball    # one widget
 *   face-gate --shard 1/2         # the first of two slices of the widget list
 *
 * Writes no pictures: the gate judges the DOM.
 */
import {
  scopeWidgets,
  shardFlag,
  sliceShardByWidget,
  widgetFlag,
} from "./gateScope";
import { listUplinkWidgets } from "./uplinkWidgets";
import { renderWidgets } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

/** Below this the gate is iterating over whatever survived, not surveying the widget set. */
const MIN_WIDGETS = 30;

const ENGINES = ["chromium", "firefox", "webkit"] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const engineIdx = args.indexOf("--engine");
  const engine = engineIdx === -1 ? "chromium" : args[engineIdx + 1];
  if (!ENGINES.some((e) => e === engine)) {
    console.error(
      "Usage: face-gate [--engine chromium|firefox|webkit] [--widget <id>] [--shard <i>/<n>]",
    );
    process.exit(1);
  }
  const shard = shardFlag(args);
  // Sliced here, by widget, so the stale-debt check sees every config of a widget in one shard.
  const scope = scopeWidgets(
    [...listWidgets(), ...(await listUplinkWidgets())],
    widgetFlag(args),
    "face-gate",
    MIN_WIDGETS,
  );
  const widgets = sliceShardByWidget(scope.widgets, shard);
  const refusal =
    scope.refusal ??
    (widgets.length === 0
      ? `\nface-gate: shard ${shard?.index}/${shard?.count} holds no render config. Refusing to report a clean run over nothing.`
      : null);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  console.log(`face-gate: ${widgets.length} widgets, ${engine}`);
  await renderWidgets(
    widgets.map((w) => ({ ...w, checkFaces: true })),
    {
      engine: engine as (typeof ENGINES)[number],
      capture: false,
      checkFaces: true,
      concurrency: Number(process.env.FACE_GATE_PAGES ?? 4),
    },
  );
  console.log("\nface-gate: no control changed face and moved anything else.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
