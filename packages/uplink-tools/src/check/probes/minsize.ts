import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gridToPixels } from "@ksp-gonogo/ui-kit/grid";
import { resolveUplinkPackage } from "../../render/context";
import { engine } from "../../render/driver";
import type { MinFitFinding } from "../../render/minFit";
import { buildProbePage } from "../../render/page";
import { RENDER_PROBE_GLOBAL } from "../../render/probe-global";
import type { ScenePayload } from "../../render-probe";
import { CheckUnableError } from "../program";
import type { Finding } from "../types";

/** The instant the render harness pins elsewhere; only its fixedness matters. */
const PINNED_UT = 1_000_000;

/**
 * The finding kinds the planted broken widget must be seen to have. The audit
 * names a heading no tile this size can hold and content behind an
 * `overflow: hidden` with nothing to scroll; an audit that reports anything
 * else cannot be trusted on this client.
 */
const CANARY_KINDS = "text-cut-off, title-clipped";

/**
 * Two widgets planted beside the client's own: one broken in the ways the
 * audit must name, one that fits. A check whose every failure mode (a bundle
 * that registered nothing, a probe that threw before the audit, an audit that
 * lost a rule) produces an empty list reports success when it sees nothing, so
 * it is not believed until it has seen the first and passed the second.
 *
 * Written into the client's own directory so every bare specifier resolves as
 * the client's source does.
 */
const PROBE_SOURCE = `
import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import { Panel } from "@ksp-gonogo/ui-kit";

const CANARY_ID = "uplink-tools-minsize-canary";
const FITS_ID = "uplink-tools-minsize-fits";

function Canary() {
  return (
    <Panel panelTitle="A DELIBERATELY UNREASONABLE TITLE THAT NO TILE THIS SIZE COULD EVER HOLD">
      <div style={{ overflow: "hidden", height: 24 }}>
        <div style={{ height: 400 }}>
          Four hundred pixels of text behind a twenty-four pixel window with
          nothing to scroll
        </div>
      </div>
    </Panel>
  );
}

registerComponent({
  id: CANARY_ID,
  name: "Min-size canary",
  description: "Planted by uplink-tools check: proves the audit can still see a widget that does not fit.",
  tags: ["diagnostics"],
  component: Canary,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
});

function Fits() {
  return <Panel panelTitle="Fits">OK</Panel>;
}

registerComponent({
  id: FITS_ID,
  name: "Min-size fitting widget",
  description: "Planted by uplink-tools check: proves the audit passes a widget that fits.",
  tags: ["diagnostics"],
  component: Fits,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
});

globalThis.__minsizeCanaryId = CANARY_ID;
globalThis.__minsizeFitsId = FITS_ID;
globalThis.__minsizeWidgets = () =>
  getComponents().map((def) => ({
    id: def.id,
    name: def.name,
    minSize: def.minSize ? { ...def.minSize } : undefined,
    declaredTopics: [
      ...new Set([
        ...(def.channels ?? []),
        ...(def.optionalChannels ?? []),
        ...(def.dataRequirements ?? []).map(String),
      ]),
    ],
  }));
`;

interface SweptWidget {
  id: string;
  name: string;
  minSize?: { w: number; h: number };
  declaredTopics: string[];
}

declare global {
  var __minsizeCanaryId: string;
  var __minsizeFitsId: string;
  var __minsizeWidgets: () => SweptWidget[];
}

const kindsOf = (findings: readonly MinFitFinding[]): string =>
  [...new Set(findings.map((f) => f.kind))].sort().join(", ");

const describe = (findings: readonly MinFitFinding[], cap = 4): string => {
  const lines = findings
    .slice(0, cap)
    .map((f) => `${f.kind} ${f.px}px [${f.axis}] "${f.text}"`);
  if (findings.length > cap) lines.push(`and ${findings.length - cap} more`);
  return lines.join("; ");
};

export interface MinsizeResult {
  /** Widgets rendered at the minimum they declare. */
  swept: number;
  misfits: { widget: SweptWidget; findings: MinFitFinding[] }[];
}

/**
 * Renders every widget the client registers at the `minSize` it declares, in a
 * real browser, and returns the ones an operator could not read there.
 *
 * The measurement is in pixels through a real layout, so the verdict is the
 * rendering platform's: a clean macOS run does not prove a Linux one.
 */
export async function sweepMinSize(clientDir: string): Promise<MinsizeResult> {
  const pkg = resolveUplinkPackage(clientDir);
  const probeFile = join(clientDir, `.minsize-probe.${process.pid}.tsx`);
  writeFileSync(probeFile, PROBE_SOURCE, "utf8");
  let browser: Awaited<
    ReturnType<Awaited<ReturnType<typeof engine>>["launch"]>
  >;
  let page: Awaited<ReturnType<typeof buildProbePage>> | undefined;
  try {
    page = await buildProbePage(pkg, [...pkg.renderWith, probeFile]);
    try {
      browser = await (await engine("chromium")).launch();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (/Executable doesn't exist|playwright install/i.test(reason)) {
        throw new CheckUnableError(
          "minsize draws every widget in a browser and this machine has none for playwright. " +
            "Install one:\n  npx playwright install chromium",
        );
      }
      throw err;
    }
    try {
      const context = await browser.newContext({
        viewport: { width: 900, height: 900 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      const tab = await context.newPage();
      const pageErrors: string[] = [];
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

      const audit = async (widget: SweptWidget): Promise<MinFitFinding[]> => {
        const min = widget.minSize as { w: number; h: number };
        await tab.evaluate(
          ([key, scene]) =>
            globalThis[key as typeof RENDER_PROBE_GLOBAL].renderScene(
              scene as ScenePayload,
            ),
          [
            RENDER_PROBE_GLOBAL,
            {
              target: { kind: "widget" as const, id: widget.id },
              fixture: `${widget.id}@min`,
              pinnedUt: PINNED_UT,
              declaredTopics: widget.declaredTopics,
              emits: [] as ScenePayload["emits"],
              config: {},
              slotProps: {},
              dataSources: {},
              w: min.w,
              h: min.h,
              ...gridToPixels(min.w, min.h),
              // No data source is registered and nothing is emitted; the flag only tells an author-written render setup the truth.
              starve: true,
            },
          ] as const,
        );
        return tab.evaluate(
          (key) => globalThis[key as typeof RENDER_PROBE_GLOBAL].auditMinFit(),
          RENDER_PROBE_GLOBAL,
        );
      };

      const all = await tab.evaluate(() => globalThis.__minsizeWidgets());
      const canaryId = await tab.evaluate(() => globalThis.__minsizeCanaryId);
      const fitsId = await tab.evaluate(() => globalThis.__minsizeFitsId);

      const canary = all.find((w) => w.id === canaryId);
      if (!canary?.minSize) {
        throw new CheckUnableError(
          "BLIND. The planted broken widget did not register, so nothing proves the audit still works.",
        );
      }
      const seen = kindsOf(await audit(canary));
      if (seen !== CANARY_KINDS) {
        throw new CheckUnableError(
          `BLIND. The planted widget clips its own title and hides 400px behind a 24px window with nothing to scroll, and the audit reported "${seen || "(nothing)"}" instead of "${CANARY_KINDS}". A check that cannot see a fault it planted itself reports zero, and zero reads as success, so no result for this client is trustworthy.`,
        );
      }
      const fits = all.find((w) => w.id === fitsId);
      if (!fits?.minSize) {
        throw new CheckUnableError(
          "BLIND. The planted fitting widget did not register, so nothing proves the audit passes a widget that fits.",
        );
      }
      const fitsFindings = await audit(fits);
      if (fitsFindings.length > 0) {
        throw new CheckUnableError(
          `The planted widget fits its tile and the audit reported it anyway, so every finding for this client may be false: ${describe(fitsFindings)}`,
        );
      }

      const declared = all
        .filter((w) => w.id !== canaryId && w.id !== fitsId && w.minSize)
        .sort((a, b) => a.id.localeCompare(b.id));
      const misfits: MinsizeResult["misfits"] = [];
      for (const widget of declared) {
        const findings = await audit(widget);
        if (findings.length > 0) misfits.push({ widget, findings });
      }
      if (pageErrors.length > 0) {
        throw new CheckUnableError(
          `${pageErrors.length} uncaught page error(s), so a widget that threw was audited as if it had rendered:\n  ${[...new Set(pageErrors)].join("\n  ")}`,
        );
      }
      return { swept: declared.length, misfits };
    } finally {
      await browser.close();
    }
  } finally {
    await page?.dispose();
    rmSync(probeFile, { force: true });
  }
}

/** The sweep as findings, one per widget that does not fit the minimum it declares. */
export async function checkMinSize(
  clientDir: string,
  sweep: (dir: string) => Promise<MinsizeResult> = sweepMinSize,
): Promise<Finding[]> {
  const { misfits } = await sweep(clientDir);
  return misfits.map(({ widget, findings }) => ({
    rule: "minsize/misfit",
    severity: "error",
    file: join(clientDir, "package.json"),
    line: 1,
    message: `${widget.id} ("${widget.name}") is unreadable at the ${widget.minSize?.w}x${widget.minSize?.h} minSize it declares: ${describe(findings)}.`,
    fixable: false,
    fix: "A heading that will not fit wants <Panel compactTitle>; content that overflows wants a scroller rather than an overflow:hidden with nothing to scroll. If neither is honest, raise the widget's minSize.",
  }));
}
