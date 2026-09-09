#!/usr/bin/env tsx
/**
 * Review renders for the third eligibility state (`3e0a841fa`).
 *
 * `canActivate` is a THREE-valued reading and `Strategies` now draws all three.
 * The bug it fixes is one only a picture states plainly: with the
 * Administration Building shut, KSP answers eligibility for nothing on the
 * roster, and the old parse coerced that silence to `false`, so a live RP-1
 * career put its whole programme list under a heading reading LOCKED while
 * every card underneath said the state was unknown.
 *
 * Two scenes, and the pair is the point:
 *
 * - `admin-building-shut` is that career: 91 real RP-1 rows, 88 of them
 *   unanswered. It is the scene worth rendering against BOTH sides of the
 *   commit, because the heading is the defect
 * - `three-buckets` cuts the same roster down until Available, Locked and
 *   Eligibility unknown are on screen together, which the shut-facility scene
 *   cannot show: it leaves Available empty by construction
 *
 * Deliberately NOT registered in `widgets.ts`, for the reason
 * `render-reckoned-tail.ts` gives: that file is the visual gate's input, and a
 * scene added to it with no committed baseline fails the gate as MISSING.
 * These exist to be looked at by a person.
 *
 * No `dist` staleness guard here, unlike `render-reckoned-tail.ts`: the change
 * being shown is `src/Strategies/index.tsx`, which esbuild bundles from source,
 * so this render cannot predate it.
 *
 * Run via `pnpm --filter @ksp-gonogo/components render-eligibility-unknown`.
 * Pass `--out <dir>` to write somewhere other than this checkout's
 * `local_docs`, which is how the BEFORE half is captured without the two runs
 * overwriting each other.
 */
import { renderWidgets, type WidgetRenderConfig } from "./widgetRenderHarness";

const CONFIGS: WidgetRenderConfig[] = [
  {
    widgetId: "strategies",
    label: "strategies/eligibility-unknown-roster",
    slug: "strategies-eligibility-roster",
    fixturesPath: "Strategies/__render_unknown__",
    outPath: "renders/eligibility-unknown/roster",
    /*
     * Fixed tile, not full content. The scene's whole claim is the HEADING over
     * a long list, and growing the capture to swallow 88 cards buries it in a
     * picture nobody can read at a glance. The tile is also what an operator
     * actually has.
     */
    modes: [
      /*
       * Scrolled past the three running programmes, because at rest the tile
       * shows nothing but those and the heading this scene is ABOUT is a
       * thousand pixels below the fold. The same offset is used for the BEFORE
       * capture, where the section order is identical and the heading in the
       * same place reads LOCKED.
       */
      {
        name: "wide-9x14-scrolled",
        w: 9,
        h: 14,
        scroll: 700,
        forFixtures: ["1-admin-building-shut"],
      },
      {
        name: "wide-9x14-at-rest",
        w: 9,
        h: 14,
        forFixtures: ["1-admin-building-shut"],
      },
    ],
  },
  {
    widgetId: "strategies",
    label: "strategies/eligibility-unknown-buckets",
    slug: "strategies-eligibility-buckets",
    fixturesPath: "Strategies/__render_unknown__",
    outPath: "renders/eligibility-unknown/buckets",
    // Whole content, because the claim here is that the three headings coexist
    // and one of them below the fold would be the same as it not being there.
    fullContent: true,
    modes: [
      { name: "buckets-9x14", w: 9, h: 14, forFixtures: ["2-three-buckets"] },
    ],
  },
];

const outFlag = process.argv.indexOf("--out");
const outBase = outFlag !== -1 ? process.argv[outFlag + 1] : undefined;

renderWidgets(CONFIGS, { outBase }).catch((err) => {
  console.error(err);
  process.exit(1);
});
