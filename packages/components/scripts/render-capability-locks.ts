#!/usr/bin/env tsx
/**
 * Review renders for capability locks: the Maneuver Planner on a save whose
 * Mission Control has not unlocked flight planning (the whole widget refuses
 * itself), and the same planner with an Uplink section whose part tech is
 * not researched (only that section refuses itself), beside the unlocked
 * scenes they replace.
 *
 * Not registered in `widgets.ts`, for the reason
 * `render-eligibility-unknown.ts` gives: a scene there with no committed
 * baseline fails the visual gate as MISSING. This exists to be looked at.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-capability-locks`.
 * Pass `--out <dir>` to write somewhere other than this checkout's
 * `local_docs`.
 */
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "maneuver-planner",
    label: "maneuver-planner/unlocked",
    slug: "planner-unlocked",
    fixturesPath: "ManeuverPlanner/__fixtures__",
    outPath: "renders/capability-locks/before",
    fullContent: true,
    modes: [
      {
        name: "default-10x18",
        w: 10,
        h: 18,
        forFixtures: ["kerbin-suborbital-prograde-node"],
      },
    ],
  },
  {
    widgetId: "maneuver-planner",
    label: "maneuver-planner/locks",
    slug: "planner-locks",
    fixturesPath: "ManeuverPlanner/__fixtures__/locks",
    outPath: "renders/capability-locks/after",
    fullContent: true,
    modes: [
      { name: "default-10x18", w: 10, h: 18 },
      { name: "narrow-5x18", w: 5, h: 18 },
    ],
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
