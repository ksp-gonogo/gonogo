/**
 * Min-size gate: no widget may be unusable at the size it itself declares it
 * can live at.
 *
 * Every widget declares a `minSize`, and the dashboard enforces it as a floor:
 * react-grid-layout refuses to drag the tile smaller and a saved layout below it
 * is clamped up. So the number is a promise to the operator, and until now
 * nothing checked it. A live sweep of 53 widgets found 12 whose own TITLE
 * ellipsises at their own minimum and two with content clipped behind an
 * `overflow: hidden` that has nothing to scroll. The shipped default layout
 * places six widgets AT their minSize, so this is not an edge case somebody has
 * to go looking for.
 *
 * ## What it renders, and why unfed
 *
 * Every registered widget, mounted at `gridToPixels(minSize)` through the
 * published render probe, with no data fed. That is deliberate and it is a
 * FLOOR rather than a compromise: an unfed widget shows its empty state, which
 * is the least content it will ever carry. A title that ellipsises, or content
 * clipped with nothing to scroll, when the widget is showing the least it can,
 * is worse with data and never better. So every finding here is real, and the
 * gate under-reports rather than over-reports, which is the right bias for a
 * shrink-only ratchet.
 *
 * The widget's own declared topics are carried by the stream fixture even though
 * nothing is emitted on them, so it renders the "no data yet" state it shows in
 * the app rather than the "not carried on this install" state, which is a
 * different and usually shorter string.
 *
 * ## It proves it can still see
 *
 * `minsize-probe.tsx` registers a widget that is broken in all five ways the
 * audit can name. The gate mounts it too and REFUSES to report on anything else
 * unless it comes back broken, because every way this check can quietly stop
 * working (a bundle that mounts nothing, a probe that throws before the audit, a
 * selector that stops matching) produces an empty findings array, and an empty
 * array reads as "everything fits".
 *
 * Usage:
 *   pnpm --filter @ksp-gonogo/app minsize-gate
 *   pnpm --filter @ksp-gonogo/app minsize-gate --report
 *   pnpm --filter @ksp-gonogo/app minsize-gate --widget <id>
 *   pnpm --filter @ksp-gonogo/app minsize-gate --update
 *   pnpm --filter @ksp-gonogo/app minsize-gate --shots <dir>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildProbePage,
  gridToPixels,
  type MinFitFinding,
  RENDER_PROBE_GLOBAL,
} from "@ksp-gonogo/ui-kit/render";
import type {
  RenderProbeApi,
  ScenePayload,
} from "@ksp-gonogo/ui-kit/render-probe";
import { chromium, type Page } from "playwright";
import { KNOWN_MISFITS } from "./minsize-debt";
import type { MinSizeWidget } from "./minsize-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "..");
const DEBT_FILE = join(HERE, "minsize-debt.ts");

/**
 * Every module whose import registers widgets in the running app.
 *
 * Bare specifiers, resolved from `packages/app`, which is the one package that
 * depends on all of them. Two Uplinks reach the app through the runtime bundle
 * loader rather than a static import, and they are named here anyway: which
 * widgets a gate covers should not depend on how their bundle happens to be
 * delivered, and the FAR Uplink is one of the two worst offenders.
 */
const REGISTRATIONS = [
  "@ksp-gonogo/components",
  "@ksp-gonogo/serial",
  "@ksp-gonogo/gonogo-breaking-ground-uplink",
  "@ksp-gonogo/gonogo-ferram-aerospace-research-uplink",
  "@ksp-gonogo/gonogo-kerbalism-uplink",
  "@ksp-gonogo/gonogo-kos-uplink",
  "@ksp-gonogo/gonogo-mechjeb-uplink",
  "@ksp-gonogo/gonogo-principia-uplink",
  "@ksp-gonogo/gonogo-real-fuels-uplink",
  "@ksp-gonogo/gonogo-realantennas-uplink",
  "@ksp-gonogo/gonogo-rp1-uplink",
  // The app's own two widgets, by path: they are not a package of their own,
  // and they carry a minSize like every other widget.
  resolve(APP_DIR, "src/goNoGo/GoNoGoComponent.tsx"),
  resolve(APP_DIR, "src/notes/NotesComponent.tsx"),
];

/** Matches `renderScene`'s pinned instant elsewhere in the harness. */
const PINNED_UT = 1_000_000;

interface Args {
  report: boolean;
  update: boolean;
  widget?: string;
  shots?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { report: false, update: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--report") args.report = true;
    else if (flag === "--update") args.update = true;
    else if (flag === "--widget") args.widget = value();
    else if (flag === "--shots") args.shots = resolve(process.cwd(), value());
    else throw new Error(`unknown flag "${flag}"`);
  }
  return args;
}

type ProbeWindow = Record<typeof RENDER_PROBE_GLOBAL, RenderProbeApi>;

function payloadFor(widget: MinSizeWidget, w: number, h: number): ScenePayload {
  return {
    target: { kind: "widget", id: widget.id },
    fixture: `${widget.id}@min`,
    pinnedUt: PINNED_UT,
    carriedChannels: widget.carried,
    emits: [],
    config: {},
    slotProps: {},
    dataSources: {},
    w,
    h,
    ...gridToPixels(w, h),
    starve: false,
  };
}

async function mountAndAudit(
  tab: Page,
  widget: MinSizeWidget,
  w: number,
  h: number,
): Promise<MinFitFinding[]> {
  await tab.evaluate(
    ([key, scene]) =>
      (globalThis as unknown as ProbeWindow)[
        key as typeof RENDER_PROBE_GLOBAL
      ].renderScene(scene as ScenePayload),
    [RENDER_PROBE_GLOBAL, payloadFor(widget, w, h)] as const,
  );
  return tab.evaluate(
    (key) =>
      (globalThis as unknown as ProbeWindow)[
        key as typeof RENDER_PROBE_GLOBAL
      ].auditMinFit(),
    RENDER_PROBE_GLOBAL,
  );
}

/** The finding kinds this widget shows, sorted, as the debt records them. */
function kindsOf(findings: readonly MinFitFinding[]): string {
  return [...new Set(findings.map((f) => f.kind))].sort().join(", ");
}

/** Four is enough to recognise the defect; a widget whose whole body is below
 *  the fold reports one finding per row and would otherwise bury the summary.
 *  A run scoped to one widget with `--widget` prints all of them. */
function describe(
  widget: MinSizeWidget,
  findings: MinFitFinding[],
  cap = 4,
): string {
  const min = widget.minSize;
  const px = min ? gridToPixels(min.w, min.h) : { pxW: 0, pxH: 0 };
  const head = `  ${widget.id}  "${widget.name}"  min ${min?.w}x${min?.h} (${px.pxW}x${px.pxH}px)`;
  const lines = findings
    .slice(0, cap)
    .map((f) => `      ${f.kind} ${f.px}px [${f.axis}]  "${f.text}"`);
  const more =
    findings.length > cap
      ? [`      ... and ${findings.length - cap} more`]
      : [];
  return [head, ...lines, ...more].join("\n");
}

function rewriteDebt(found: Map<string, string>): void {
  const source = readFileSync(DEBT_FILE, "utf8");
  const marker = "export const KNOWN_MISFITS: Record<string, string> = {";
  const at = source.indexOf(marker);
  if (at === -1) {
    throw new Error(`minsize-gate: cannot find KNOWN_MISFITS in ${DEBT_FILE}`);
  }
  const body = [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    // Quoted only when the id is not a bare identifier, because the formatter
    // strips a redundant quote and a rewrite it would reformat fails the commit
    // hook the moment anyone runs `--update`.
    .map(([id, kinds]) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id);
      return `  ${key}: ${JSON.stringify(kinds)},`;
    })
    .join("\n");
  const next = `${source.slice(0, at)}${marker}\n${body}\n};\n`;
  writeFileSync(DEBT_FILE, next, "utf8");
  console.log(
    `minsize-gate: rewrote ${DEBT_FILE} with ${found.size} entr(ies).`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const page = await buildProbePage(
    {
      dir: APP_DIR,
      name: "@ksp-gonogo/app",
      version: "0.0.0",
      entry: join(HERE, "minsize-probe.tsx"),
      fixtures: [],
      renderWith: [],
    },
    REGISTRATIONS,
  );

  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const tab = await context.newPage();
    tab.on("pageerror", (err) => pageErrors.push(err.message));
    await tab.goto(pathToFileURL(page.file).toString(), {
      waitUntil: "domcontentloaded",
    });
    await tab.waitForFunction(
      (key) =>
        typeof (globalThis as Record<string, unknown>)[key as string] ===
        "object",
      RENDER_PROBE_GLOBAL,
      { timeout: 30_000 },
    );

    const all = await tab.evaluate(() =>
      (
        globalThis as unknown as { __minsizeWidgets: () => MinSizeWidget[] }
      ).__minsizeWidgets(),
    );
    const canaryId = await tab.evaluate(
      () =>
        (globalThis as unknown as { __minsizeCanaryId: string })
          .__minsizeCanaryId,
    );

    // The planted canary must fail, or the sweep below proves nothing.
    const canary = all.find((w) => w.id === canaryId);
    if (!canary?.minSize) {
      throw new Error(
        "minsize-gate: BLIND. The planted canary widget did not register, so " +
          "nothing proves the audit still works. Fix minsize-probe.tsx rather " +
          "than skipping this.",
      );
    }
    const canaryFindings = await mountAndAudit(
      tab,
      canary,
      canary.minSize.w,
      canary.minSize.h,
    );
    const canaryKinds = kindsOf(canaryFindings);
    const WANTED =
      "box-clipped, box-escapes-tile, escapes-tile, text-cut-off, title-clipped";
    if (canaryKinds !== WANTED) {
      throw new Error(
        `minsize-gate: BLIND. The planted canary is broken in five ways and ` +
          `the audit reported "${canaryKinds || "(nothing)"}" instead of ` +
          `"${WANTED}". A check that cannot see a violation it planted itself ` +
          `reports zero, and zero reads as success. No result from this run is ` +
          `trustworthy.`,
      );
    }

    const subjects = all
      .filter((w) => w.id !== canaryId)
      .filter((w) => (args.widget ? w.id === args.widget : true))
      .sort((a, b) => a.id.localeCompare(b.id));
    const undeclared = subjects.filter((w) => !w.minSize).map((w) => w.id);
    const declared = subjects.filter((w) => w.minSize);
    if (declared.length === 0) {
      throw new Error(
        "minsize-gate: no widget with a declared minSize was examined, so the " +
          "gate checked nothing. A gate that inspects an empty set reports " +
          "success for the wrong reason.",
      );
    }

    if (args.shots) mkdirSync(args.shots, { recursive: true });

    const found = new Map<string, string>();
    const detail: string[] = [];
    for (const widget of declared) {
      const min = widget.minSize as { w: number; h: number };
      const findings = await mountAndAudit(tab, widget, min.w, min.h);
      if (args.shots) {
        const root = await tab.$("#root");
        await root?.screenshot({
          path: join(args.shots, `${widget.id}--min.png`),
          animations: "disabled",
        });
      }
      if (findings.length === 0) continue;
      found.set(widget.id, kindsOf(findings));
      detail.push(
        describe(widget, findings, args.widget ? findings.length : 4),
      );
    }

    if (pageErrors.length > 0) {
      throw new Error(
        `minsize-gate: ${pageErrors.length} uncaught page error(s), so a widget ` +
          `that threw was audited as if it had rendered:\n  ` +
          `${[...new Set(pageErrors)].join("\n  ")}`,
      );
    }

    const swept =
      `minsize-gate: ${declared.length} widget(s) rendered at the minSize they ` +
      `declare; ${found.size} do not fit.`;
    // A widget with no declared minSize has made no promise, so there is nothing
    // to hold it to. Named rather than silently skipped: the count is the honest
    // limit of what this gate can say.
    if (undeclared.length > 0) {
      console.log(
        `  ${undeclared.length} widget(s) declare no minSize and were not ` +
          `checked: ${undeclared.join(", ")}`,
      );
    }

    if (args.update) {
      rewriteDebt(found);
      console.log(swept);
      return;
    }

    if (args.report) {
      console.log(swept);
      if (detail.length > 0) console.log(detail.join("\n"));
      return;
    }

    const regressions: string[] = [];
    for (const [id, kinds] of found) {
      const owed = KNOWN_MISFITS[id];
      if (owed === undefined) regressions.push(`  ${id}  ${kinds}  (new)`);
      else if (owed !== kinds) {
        regressions.push(`  ${id}  ${kinds}  (recorded as "${owed}")`);
      }
    }
    // Scoping to one widget cannot speak about the rest of the list, so the
    // stale half is only meaningful on a full run.
    const fixed = args.widget
      ? []
      : Object.keys(KNOWN_MISFITS).filter((id) => !found.has(id));

    if (fixed.length > 0) {
      console.error(
        `minsize-gate: ${fixed.length} recorded misfit(s) now fit at their own\n` +
          `declared minSize:\n${fixed.map((id) => `  ${id}`).join("\n")}\n\n` +
          `That is the good direction. Delete the line(s) from\n` +
          `packages/app/scripts/minsize-debt.ts so the debt shrinks; the list may\n` +
          `only ever get smaller, and a fixed entry left in it is a permission\n` +
          `nobody needs.`,
      );
      process.exitCode = 1;
    }

    if (regressions.length > 0) {
      console.error(
        `minsize-gate: ${regressions.length} widget(s) are unusable at the size\n` +
          `they themselves declare they can live at, and are not recorded debt:\n\n` +
          `${regressions.join("\n")}\n\n${detail.join("\n")}\n\n` +
          `Two ways out, both legitimate:\n` +
          `  - make it fit. A heading that will not wants <Panel compactTitle>,\n` +
          `    which draws the widest of the shorter forms you give it that the\n` +
          `    box has room for; content that overflows wants a scroller rather\n` +
          `    than an overflow:hidden with nothing to scroll.\n` +
          `  - RAISE its minSize, when the honest answer is that the widget cannot\n` +
          `    be that small. Say so in the commit.\n\n` +
          `Do NOT add it to minsize-debt.ts: that list is seeded and shrink-only.`,
      );
      process.exitCode = 1;
    }

    if (process.exitCode) return;
    console.log(
      `${swept} Every one is recorded in minsize-debt.ts, which is shrink-only.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
