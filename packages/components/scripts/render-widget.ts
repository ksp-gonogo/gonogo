#!/usr/bin/env tsx
/**
 * Render one widget (`render-widget navball`) or every widget
 * (`render-widget --all`) through the shared playwright harness. Reads
 * configs from `widgets.ts`; new widgets are added by editing that file
 * — no package.json change, no new CLI script.
 *
 * Run via `pnpm --filter @gonogo/components render-widget …`.
 */
import { renderScreens, renderWidgets } from "./widgetRenderHarness";
import { getScreen, getWidget, listScreens, listWidgets } from "./widgets";

function usage(): never {
  console.error(
    "Usage: render-widget <widget-id> | --all | --list\n" +
      "       render-widget --screen <screen-id> | --screens\n" +
      "       Known widget ids: " +
      listWidgets()
        .map((w) => w.widgetId)
        .join(", ") +
      "\n       Known screen ids: " +
      listScreens()
        .map((s) => s.screenId)
        .join(", "),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  if (args.includes("--list")) {
    for (const w of listWidgets()) {
      console.log(
        `${w.widgetId.padEnd(24)} ${w.modes.length} modes → local_docs/${w.outPath}/`,
      );
    }
    for (const s of listScreens()) {
      console.log(
        `${`[screen] ${s.screenId}`.padEnd(24)} ${s.states.length}×${s.breakpoints.length} → local_docs/${s.outPath}/`,
      );
    }
    return;
  }

  if (args.includes("--screens")) {
    await renderScreens([...listScreens()]);
    return;
  }

  const screenFlag = args.indexOf("--screen");
  if (screenFlag !== -1) {
    const id = args[screenFlag + 1];
    if (!id) usage();
    const config = getScreen(id);
    if (!config) {
      console.error(`Unknown screen id: ${id}`);
      usage();
    }
    await renderScreens([config]);
    return;
  }

  if (args.includes("--all")) {
    await renderWidgets([...listWidgets()]);
    return;
  }

  const id = args[0];
  if (id.startsWith("--")) usage();
  const config = getWidget(id);
  if (!config) {
    console.error(`Unknown widget id: ${id}`);
    usage();
  }
  await renderWidgets([config]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
