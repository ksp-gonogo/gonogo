import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A widget-authored augment slot must not be named after a FRAMEWORK segment.
 *
 * `Panel` mounts `${componentId}.sections` and `${componentId}.actions` for
 * every widget, whether or not that widget asked. A widget that ALSO renders
 * `<AugmentSlot name="its-own-id.sections">` therefore has two mounts on one
 * string, and every augment bound to it renders twice: once with the widget's
 * props and once with the segment's empty ones. Augments have no dedupe, so
 * nothing says a word.
 *
 * This is measured, not theoretical. `deployed-science.sections` was a per-card
 * slot passing `{ experiment, body }`; the moment `Panel` began mounting the
 * segment, its own test died on `Cannot read properties of undefined (reading
 * 'name')` from the second, propless render. Four slots in the tree were in that
 * position and one more (`warp-control.actions`) was body-inline under a name
 * the framework now owns.
 *
 * The rule is a NAMING one and it is cheap: a per-row or positioned slot is
 * named for what it addresses (`deployed-science.experiment`,
 * `experiments.instrument`, `crew-status.row-badges`), never for a segment. A
 * slot that genuinely IS the universal seam does not need a name at all: delete
 * the render site and let `Panel` mount it, or place `<WidgetSections>` where it
 * belongs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const ROOTS = [join(REPO, "packages"), join(REPO, "mod")];

/**
 * The segments `Panel` mounts for every widget. Duplicated from ui-kit's
 * `FRAMEWORK_AUGMENT_SEGMENTS` rather than imported: this file scans SOURCE
 * TEXT across packages that do not all depend on each other, and a scanner that
 * imports its own subject can be defeated by the subject changing. The unit test
 * beside the constant asserts the two agree.
 */
const FRAMEWORK_SEGMENTS = ["sections", "actions"];

/** `<AugmentSlot name="x.y"` including the form that wraps `name` onto its own line. */
const NAMED_SLOT_RE = /<AugmentSlot\s+name=\{?["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx$/.test(entry)) continue;
    // Tests and probes render the widget-led form on purpose, including the one
    // that proves the double-render this guard exists to stop. The rule is about
    // what SHIPS.
    if (/\.(test|spec)\.tsx$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("no widget renders a named slot on a framework segment", () => {
  it('finds no `<AugmentSlot name="*.sections">` or `*.actions` render site', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, "utf8");
        for (const [, slot] of text.matchAll(NAMED_SLOT_RE)) {
          const segment = slot.split(".").pop();
          if (segment && FRAMEWORK_SEGMENTS.includes(segment)) {
            offenders.push(`${slot}  (${relative(REPO, file)})`);
          }
        }
      }
    }

    expect(
      [...new Set(offenders)].sort(),
      `These render sites collide with a segment \`Panel\` already mounts for\n` +
        `every widget, so each bound augment renders TWICE, the second time with\n` +
        `empty props:\n\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nEither delete the render site (Panel mounts the seam), place\n` +
        `<WidgetSections> and pass panelSections={false}, or rename the slot for\n` +
        `what it actually addresses.`,
    ).toEqual([]);
  });

  it("actually reaches the widgets it claims to scan", () => {
    // A file walk that resolved nothing would report zero offenders and read as
    // success. Anchor it on a slot render site that is definitely there.
    const slots = new Set<string>();
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        for (const [, slot] of readFileSync(file, "utf8").matchAll(
          NAMED_SLOT_RE,
        )) {
          slots.add(slot);
        }
      }
    }
    expect(slots.has("map-view.overlay")).toBe(true);
    expect(slots.size).toBeGreaterThan(5);
  });

  it("sees a collision when there is one", () => {
    // The scanner is only worth its green if it can go red. Same regex, same
    // shape, against a line that is deliberately wrong.
    const planted = `<AugmentSlot name="deployed-science.sections" props={{}} />`;
    const hits = [...planted.matchAll(NAMED_SLOT_RE)].map(([, slot]) =>
      slot.split(".").pop(),
    );
    expect(hits).toEqual(["sections"]);
    expect(FRAMEWORK_SEGMENTS).toContain(hits[0]);
  });

  it("reads the multi-line render form the single-line grep misses", () => {
    const planted = `<AugmentSlot\n          name="power-systems.actions"\n          props={{}}\n        />`;
    const hits = [...planted.matchAll(NAMED_SLOT_RE)].map(([, slot]) => slot);
    expect(hits).toEqual(["power-systems.actions"]);
  });
});
