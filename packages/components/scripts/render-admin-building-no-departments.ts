#!/usr/bin/env tsx
/**
 * Review renders for Saga #649 (T4): a `strategies.screens` contribution
 * naming no departments must draw no strategy lists, since the sdk contract
 * already says such a screen "lists nothing and is chrome for its augments"
 * (`contribution-slots.ts`).
 *
 * The scene: the planted Uplink's `strategies-finances-screen` contribution
 * (`scripts/probe/plantedUplink.ts`, gated on `planted.available`) puts one
 * screen with no `departments` alongside a real three-department roster.
 * Nobody claims Operations/Finances/Public Relations, so they land on the
 * trailing "Other" screen untouched; the planted screen is the one under
 * test. No augment is bound to its body, so the fix is visible as the whole
 * tab going blank rather than the old placeholder text.
 *
 * Deliberately NOT registered in `widgets.ts`, for the reason
 * `render-eligibility-unknown.ts` gives: that file is the visual gate's
 * input, and a scene added to it with no committed baseline fails the gate
 * as MISSING. This exists to be looked at by a person.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-admin-building-no-departments`.
 * Pass `--out <dir>` to write somewhere other than this checkout's
 * `local_docs`, which is how the BEFORE half is captured without the two
 * runs overwriting each other.
 */
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "strategies",
    label: "strategies/admin-building-no-departments",
    slug: "strategies-no-departments",
    fixturesPath: "Strategies/__fixtures__/probe",
    outPath: "renders/admin-building-no-departments",
    fullContent: true,
    modes: [
      { name: "wide-9x12", w: 9, h: 12, forFixtures: ["finances-screen"] },
    ],
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
