#!/usr/bin/env tsx
/**
 * Review renders for the widget gate counting a widget's commands: a widget
 * that reads no craft Topic and sends a craft command with no vessel, the same
 * widget in flight, and a widget that sends a ground command at the Space
 * Center.
 *
 * Not registered in `widgets.ts`, for the reason `render-capability-locks.ts`
 * gives: a scene there with no committed baseline fails the visual gate.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-command-gate`. Pass
 * `--out <dir>` to write somewhere other than this checkout's `local_docs`.
 */
import { PLANTED_COMMAND_GATE_IDS } from "./probe/plantedCommandGateWidgets.ids";
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const MODES = [{ name: "default-5x5", w: 5, h: 5 }];

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: PLANTED_COMMAND_GATE_IDS.craft,
    label: "command-gate/craft",
    slug: "command-gate-craft",
    fixturesPath: "shared/__render__",
    outPath: "renders/command-gate/craft",
    modes: MODES.map((m) => ({
      ...m,
      forFixtures: ["craft-command-vab-no-vessel", "craft-command-in-flight"],
    })),
  },
  {
    widgetId: PLANTED_COMMAND_GATE_IDS.ground,
    label: "command-gate/ground",
    slug: "command-gate-ground",
    fixturesPath: "shared/__render__",
    outPath: "renders/command-gate/ground",
    modes: MODES.map((m) => ({
      ...m,
      forFixtures: ["ground-command-space-center"],
    })),
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
