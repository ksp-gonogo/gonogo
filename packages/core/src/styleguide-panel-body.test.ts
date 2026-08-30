// @vitest-environment node
/*
 * Node realm rather than the package's jsdom default, matching
 * `styleguide-comment-stacks.test.ts`: the shrink-only half transpiles the
 * allowlist at a git ref through esbuild, which asserts a real
 * TextEncoder/Uint8Array realm.
 */
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { PANEL_BODY_DEBT, SCAN_FLOORS } from "./panel-body.allowlist";
import {
  panelBodiesIn,
  scanPanelBodies,
  stripComments,
} from "./panel-body.scan";
import { ratchetBaseRef, sourceAtRatchetBase } from "./ratchetBaseRef";

/**
 * Panel-body ratchet.
 *
 * A widget with several sections cannot lay them out horizontally when there is
 * room, because it is the widget composing its own body and a widget cannot see
 * the width it was given. So in a landscape tile it wastes the width, running
 * everything down one column. `Panel sections` moves that decision to the one
 * component that CAN answer it, alongside the two decisions of the same shape
 * Panel already owns: the compacted title and the aside collapse.
 *
 * THE RULE, in one sentence: a widget gives its `Panel` a body by passing
 * `sections`, and a converted panel is therefore self-closing.
 *
 * The single exception is `floatingHeader`, the widget that is WHOLLY a drawing
 * (a map, a globe, an orbit view). Its content is the panel rather than a
 * section of it, and it already had its own prop before this gate existed.
 *
 * Tests are outside the population. The children path is not going away, since
 * `floatingHeader` and every hand-composed `Panel.Container` arrangement use it,
 * and a gate that stopped the kit testing its own API would be asking for the
 * wrong thing.
 *
 * Lives in `packages/core` because core holds this repo's cross-package
 * ratchets, and because core's scan task is the one CI runs over the whole tree.
 */

const ALLOWLIST_PATH = "packages/core/src/panel-body.allowlist.ts";

const RESULT = scanPanelBodies();

describe("panel bodies", () => {
  /**
   * The instrument check, before any assertion that can pass by finding
   * nothing.
   *
   * Both floors count things that do NOT fall as the debt is cleared: files
   * walked, and `<Panel>` opening tags found. Converting a widget turns a body
   * into a self-closing tag, so the tag count survives the very work this gate
   * is asking for, where a floor under the debt population would be one the work
   * has to walk through.
   */
  it("actually scanned the widget tree", () => {
    const bodies = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
    const summary = [
      `scanned ${RESULT.scanned} files`,
      `${RESULT.skipped} skipped as test or generated`,
      `${RESULT.tags} Panel tags`,
      `${RESULT.counts.size} files still pass a body`,
      `${bodies} bodies`,
    ].join(", ");
    // The census, not a boolean. A number in the log is what lets the next
    // person tell "found nothing" from "looked at nothing", and it is only
    // visible under `--reporter=verbose`; the default reporter mutes console
    // output for tests that pass.
    console.info(`[panel-body] ${summary}`);
    expect(RESULT.scanned, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
    expect(RESULT.tags, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.tags);
  });

  /**
   * The instrument check for the matcher itself, which the file and tag floors
   * cannot give: both stay healthy if the matcher is edited into something that
   * never reports a body, and the debt assertions would then read as a tree that
   * converted itself overnight.
   *
   * The negative cases matter more than the positive one. Each is a `<Panel>`
   * that is NOT a body, and a gate that flagged any of them would be muted
   * within a day.
   */
  it("sees a body, and does not see a converted, floating or commented panel", () => {
    const body = `<Panel panelTitle="X">\n  <Rows />\n</Panel>`;
    expect(panelBodiesIn(body)).toHaveLength(1);

    const converted = `<Panel panelTitle="X" sections={[<Section key="a" />]} />`;
    expect(panelBodiesIn(converted)).toHaveLength(0);

    const floating = `<Panel panelTitle="X" floatingHeader>\n  <Globe />\n</Panel>`;
    expect(panelBodiesIn(floating)).toHaveLength(0);

    // A `>` inside an attribute value is ordinary in this widget set: an element
    // in a slot, an arrow function in a handler. Ending the tag at the first one
    // would read the children as attributes and miss the body entirely.
    const nestedAngles = `<Panel panelAside={<Badge tone="ok" />} onPick={(a) => set(a)}>\n  <Rows />\n</Panel>`;
    expect(panelBodiesIn(nestedAngles)).toHaveLength(1);

    // Prose, not code. Panel's own doc comment and GridItemContent both contain
    // the phrase, and a comment-blind scan seeded them into the list where no
    // rewrite could ever have cleared them.
    const prose = `/* the <Panel> it returns */\n// see the <Panel> above\n`;
    expect(panelBodiesIn(prose)).toHaveLength(0);

    // Neighbours with a shared prefix. These are the hand-composed parts, which
    // this gate says nothing about.
    const relatives = `<PanelBody>\n  <X />\n</PanelBody>\n<Panel.Header title="t">\n  <Y />\n</Panel.Header>`;
    expect(panelBodiesIn(relatives)).toHaveLength(0);
  });

  /** Comment blanking keeps byte offsets, so reported line numbers stay true. */
  it("blanks comments without moving any line", () => {
    const source = `const a = 1;\n/* two\n   lines */\nconst b = "//not a comment";\n`;
    const stripped = stripComments(source);
    expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
    expect(stripped).toContain('"//not a comment"');
    expect(stripped).not.toContain("two");
  });

  /**
   * Growth. A file with a body and no entry, or a file whose count has gone up,
   * both land here. Per file rather than per repo so the message names the file,
   * which is the whole difference between a gate somebody acts on and a gate
   * somebody mutes.
   */
  it("adds no Panel body to a file that is not already carrying one", () => {
    const offenders: string[] = [];
    for (const [file, count] of RESULT.counts) {
      const budget = PANEL_BODY_DEBT[file];
      if (budget === undefined) {
        const first = RESULT.uses.get(file)?.[0];
        offenders.push(
          `${file}:${first?.line}: ${count} Panel body/bodies, unlisted`,
        );
        continue;
      }
      if (count > budget) {
        offenders.push(`${file}: ${count} bodies, debt list says ${budget}`);
      }
    }
    expect(
      offenders,
      [
        "A <Panel> was given children instead of `sections`.",
        "",
        "`sections` is what lets Panel own the wide-layout decision: it flows",
        "the sections down one column in a portrait tile and across two or",
        "three in a landscape one, which is a call the widget cannot make",
        "because it cannot see the width it was given.",
        "",
        "  <Panel",
        '    panelTitle="THING"',
        "    sections={[",
        '      <Section key="a" title="Group">…</Section>,',
        '      <Section key="b" title="Other">…</Section>,',
        "    ]}",
        "  />",
        "",
        "One section is fine and costs nothing: `sections={<Section>…</Section>}`.",
        "",
        "The exception is a widget that is WHOLLY a drawing (a map, a globe).",
        "That one passes `floatingHeader` and keeps its children.",
        "",
        "Do NOT add an entry to panel-body.allowlist.ts. The debt list is",
        "shrink-only and a new entry means new code just wrote a body.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction, and the reason the counts are exact rather than
   * ceilings. Nothing else notices when a widget is converted, so the entry sits
   * there reading as work remaining and the list can never reach zero by
   * attrition. With this, every conversion is an automatic reduction and the
   * next person to touch the file is told to write the smaller number down.
   */
  it("records no Panel body that is already gone", () => {
    const stale: string[] = [];
    for (const [file, expected] of Object.entries(PANEL_BODY_DEBT)) {
      const actual = RESULT.counts.get(file) ?? 0;
      if (actual < expected) {
        stale.push(`${file} says ${expected}, actually ${actual}`);
      }
    }
    expect(
      stale,
      [
        "The debt list claims more Panel bodies than the file still has.",
        "",
        "Good news: something converted them. Regenerate the list so it keeps",
        "telling the truth about what is left:",
        "",
        "  node scripts/panel-body-debt.mjs --update",
        "",
        "A debt list that outlives its debt reads as work remaining and hides",
        "how close to zero this is.",
      ].join("\n"),
    ).toEqual([]);
  });

  describe("the debt list only ever shrinks", () => {
    /**
     * The list as it stood at the ratchet base, with the ref it came from so a
     * failure can quote it.
     *
     * `ratchetBaseRef` THROWS when no base can be reached, deliberately:
     * catching that and returning `undefined` would make an unreachable base
     * read as "nothing to check", turning the whole shrink guard into a pass.
     * Undefined here means only that the checkout IS the base, or that the list
     * did not exist there.
     */
    function baseAllowlist():
      | { ref: string; lists: Record<string, unknown> }
      | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const source = sourceAtRatchetBase(at, ALLOWLIST_PATH);
      if (source === null) return undefined;
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", js)(module_, module_.exports);
      return { ref: at.ref, lists: module_.exports };
    }

    /**
     * Growth is refused two different ways, because a moved file and a new body
     * look identical to a per-file comparison.
     *
     * An EXISTING entry may only fall. A NEW entry is allowed only when the
     * repo-wide total did not rise, which is what a relocation looks like: the
     * same panels under a different path, one key removed and one added, total
     * unchanged. Without it the gate fails on every file move and the only way
     * past is to lower a floor or delete the check, which is how a ratchet gets
     * muted. It is not a hole: entering raises the total, so the most it permits
     * is carrying existing debt from one file to another.
     */
    it("PANEL_BODY_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = at.lists.PANEL_BODY_DEBT as
        | Record<string, number>
        | undefined;
      if (!before) return;

      const sum = (list: Record<string, number>): number =>
        Object.values(list).reduce((a, b) => a + b, 0);
      const totalBefore = sum(before);
      const totalNow = sum(PANEL_BODY_DEBT);

      const raised: string[] = [];
      const arrived: string[] = [];
      for (const [file, count] of Object.entries(PANEL_BODY_DEBT)) {
        const was = before[file];
        if (was === undefined) arrived.push(`${file} (${count})`);
        else if (count > was) raised.push(`${file} (${was} -> ${count})`);
      }

      expect(
        raised,
        `A listed file gained Panel bodies, vs ${at.ref}. An entry may only fall.`,
      ).toEqual([]);

      expect(
        totalNow > totalBefore ? arrived : [],
        [
          `New debt entries raised the repo-wide total, vs ${at.ref}:`,
          `  ${totalBefore} -> ${totalNow}`,
          "",
          "A new entry is only allowed when the total holds, which is what a file",
          "MOVE looks like. A rising total means a body was written rather than",
          "carried, so pass `sections` instead of listing it.",
        ].join("\n"),
      ).toEqual([]);
    });

    /**
     * The floors are data in the same file and would otherwise be lowerable with
     * a one-digit edit that reads as maintenance, which would blind the
     * instrument check above. Same rule as the debt list, in the other
     * direction: up only.
     */
    it("SCAN_FLOORS", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = at.lists.SCAN_FLOORS as
        | { files: number; tags: number }
        | undefined;
      if (!before) return;
      const lowered: string[] = [];
      for (const key of ["files", "tags"] as const) {
        if (SCAN_FLOORS[key] < before[key]) {
          lowered.push(`${key} (${before[key]} -> ${SCAN_FLOORS[key]})`);
        }
      }
      expect(
        lowered,
        [
          `The scan floors may only be RAISED, vs ${at.ref}.`,
          "",
          "Lowering a floor blinds the instrument check: it is what stands",
          "between 'the scan found nothing' and 'the scan looked at nothing'.",
          "",
          "Neither floor counts the debt, precisely so that converting every",
          "last widget never reaches them. If one is genuinely in the way, the",
          "scan has changed shape and the floor needs re-deriving, not lowering.",
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
