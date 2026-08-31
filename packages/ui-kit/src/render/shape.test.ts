// @vitest-environment jsdom
//
// jsdom for the page-side walk, which needs a `document` and a
// `getComputedStyle`. What jsdom CANNOT answer is the question the shape exists
// for, whether two engines agree, and no amount of unit testing here would:
// `scripts/uplink-shape-engines.mjs` renders real widgets in chromium, firefox
// and webkit and is where that is settled. These cover the walk's own rules and
// the node-side comparison, which are logic rather than browser behaviour.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMISSIBLE_PROPERTIES,
  type AssetShape,
  compareShapes,
  describeStale,
  foldShape,
  RECORDED_ATTRIBUTES,
  readShapeRecord,
  readShapeText,
  SHAPE_RECORD_VERSION,
  writeShapeRecord,
} from "./shape";

const read = () =>
  readShapeText({
    properties: ADMISSIBLE_PROPERTIES as readonly string[],
    attributes: RECORDED_ATTRIBUTES,
  });

function mount(html: string): void {
  document.body.innerHTML = `<div id="root">${html}</div>`;
}

const shape = (hash: string, elements = 1, text = "aaaa"): AssetShape => ({
  hash,
  elements,
  text,
});

describe("readShapeText", () => {
  it("walks past #root itself, because the grow step writes a measured height into it", () => {
    mount(`<span>one</span>`);
    const { text, elements } = read();
    expect(elements).toBe(1);
    // The first path segment is the child's index, so nothing describes #root.
    expect(text.startsWith("0 span")).toBe(true);
  });

  it("carries the visible text and the element order", () => {
    mount(`<div><span>alpha</span><em>beta</em></div>`);
    const { visibleText, elements } = read();
    expect(visibleText).toBe("alpha beta");
    expect(elements).toBe(3);
  });

  it("records a whitelisted attribute and ignores one that is not", () => {
    mount(`<span title="full name" class="noise">n</span>`);
    const { text } = read();
    expect(text).toContain("title=full name");
    expect(text).not.toContain("noise");
  });

  // The prefixes had been written inside the exact-match group, in front of its
  // `$`, so only an attribute named literally `data-` matched and every real one
  // was dropped. Two engines both dropping it agree, so the cross-engine harness
  // could never have seen this.
  it("records any data- or aria- attribute, not one named exactly `data-`", () => {
    mount(
      `<div data-section-full="" aria-expanded="true"><span>n</span></div>`,
    );
    const { text } = read();
    expect(text).toContain("data-section-full=");
    expect(text).toContain("aria-expanded=true");
  });

  it("still records a bare SVG geometry attribute alongside them", () => {
    mount(`<svg><circle cx="34" cy="14" r="2.5"></circle></svg>`);
    const { text } = read();
    expect(text).toContain("cx=34");
    expect(text).toContain("r=2.5");
  });

  it("skips a stylesheet the widget injected, and a screen-reader-only word", () => {
    mount(
      `<style>.x{color:red}</style><span data-unit-word>kilometres</span><b>12.4 km</b>`,
    );
    const { visibleText, elements } = read();
    expect(visibleText).toBe("12.4 km");
    expect(elements).toBe(1);
  });

  it("rounds a long decimal, so one engine's last digit is not a difference", () => {
    // The real case is `color(srgb 0.636078 …)` against `0.636079`, which needs
    // a real engine's colour serialisation. An authored SVG path exercises the
    // same normalisation through a route jsdom can produce.
    mount(`<svg><path d="M2 20 L18.63607812 6"></path></svg>`);
    const { text } = read();
    expect(text).toContain("18.636");
    expect(text).not.toContain("18.63607812");
  });

  it("leaves a short decimal alone", () => {
    mount(`<svg><path d="M2 20 L18.65 6"></path></svg>`);
    expect(read().text).toContain("18.65");
  });
});

describe("foldShape", () => {
  it("folds a film's frames into one shape, so a step that stops firing changes it", () => {
    const frame = (t: string) => ({ text: t, elements: 2, visibleText: t });
    const moving = foldShape([frame("a"), frame("b"), frame("c")]);
    const stuck = foldShape([frame("a"), frame("a"), frame("a")]);
    expect(moving.hash).not.toBe(stuck.hash);
  });

  it("takes the element count from the first frame", () => {
    expect(
      foldShape([{ text: "x", elements: 7, visibleText: "x" }]).elements,
    ).toBe(7);
  });
});

describe("compareShapes", () => {
  const rendered = new Map([["a.png", shape("aaaa")]]);

  it("calls an asset with no record unrecorded rather than stale", () => {
    const verdict = compareShapes(undefined, rendered, "chromium");
    expect(verdict.stale).toEqual([]);
    expect(verdict.unrecorded).toEqual(["a.png"]);
  });

  it("names a changed shape as stale", () => {
    const record = {
      version: SHAPE_RECORD_VERSION,
      engine: "chromium",
      assets: { "a.png": shape("bbbb") },
    };
    const verdict = compareShapes(record, rendered, "chromium");
    expect(verdict.stale.map((s) => s.file)).toEqual(["a.png"]);
  });

  it("passes an unchanged shape", () => {
    const record = {
      version: SHAPE_RECORD_VERSION,
      engine: "chromium",
      assets: { "a.png": shape("aaaa") },
    };
    expect(compareShapes(record, rendered, "chromium").stale).toEqual([]);
  });

  it("refuses rather than failing when the record is from another engine", () => {
    const record = {
      version: SHAPE_RECORD_VERSION,
      engine: "firefox",
      assets: { "a.png": shape("bbbb") },
    };
    const verdict = compareShapes(record, rendered, "chromium");
    expect(verdict.incomparable).toContain("firefox");
    expect(verdict.stale).toEqual([]);
  });

  it("refuses rather than failing when the walk itself changed version", () => {
    const record = {
      version: SHAPE_RECORD_VERSION + 1,
      engine: "chromium",
      assets: { "a.png": shape("bbbb") },
    };
    const verdict = compareShapes(record, rendered, "chromium");
    expect(verdict.incomparable).toContain("not the same walk");
    expect(verdict.stale).toEqual([]);
  });

  it("mixes stale and unrecorded in one verdict", () => {
    const record = {
      version: SHAPE_RECORD_VERSION,
      engine: "chromium",
      assets: { "a.png": shape("bbbb") },
    };
    const verdict = compareShapes(
      record,
      new Map([
        ["a.png", shape("aaaa")],
        ["b.png", shape("cccc")],
      ]),
      "chromium",
    );
    expect(verdict.stale.map((s) => s.file)).toEqual(["a.png"]);
    expect(verdict.unrecorded).toEqual(["b.png"]);
  });
});

describe("describeStale", () => {
  it("says the tree grew", () => {
    const said = describeStale({
      file: "a.png",
      was: shape("1111", 78, "tttt"),
      now: shape("2222", 79, "tttt"),
    });
    expect(said).toContain("78 elements became 79");
  });

  it("says the text changed", () => {
    const said = describeStale({
      file: "a.png",
      was: shape("1111", 78, "tttt"),
      now: shape("2222", 78, "uuuu"),
    });
    expect(said).toContain("the visible text changed");
  });

  it("says it was styling when neither the tree nor the text moved", () => {
    const said = describeStale({
      file: "a.png",
      was: shape("1111", 78, "tttt"),
      now: shape("2222", 78, "tttt"),
    });
    expect(said).toContain("styling changed, the tree and text did not");
  });
});

describe("the record on disk", () => {
  it("round-trips, and sorts its keys so an unchanged regeneration is no diff", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shape-record-"));
    await writeShapeRecord(dir, {
      version: SHAPE_RECORD_VERSION,
      engine: "chromium",
      assets: { "b.png": shape("bbbb"), "a.png": shape("aaaa") },
    });
    const raw = readFileSync(join(dir, "render-shape.json"), "utf8");
    expect(raw.indexOf("a.png")).toBeLessThan(raw.indexOf("b.png"));
    expect(readShapeRecord(dir)?.assets["a.png"]?.hash).toBe("aaaa");
  });

  it("reports no record rather than throwing when there is none", () => {
    expect(readShapeRecord(mkdtempSync(join(tmpdir(), "shape-empty-")))).toBe(
      undefined,
    );
  });
});
