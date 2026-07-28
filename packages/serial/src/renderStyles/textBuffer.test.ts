import { describe, expect, it } from "vitest";
import { textBuffer, textBuffer168 } from "./textBuffer";

const LINE_WIDTH = 21;
const LINE_COUNT = 8;
const BLANK = " ".repeat(LINE_WIDTH);

/**
 * Slice a flat width×height buffer back into rows. The render style
 * concatenates rows with no separator and adds a trailing newline; tests
 * assert against rows, so we strip the trailer and chunk by width.
 */
function rowsOf(out: string, width: number): string[] {
  const body = out.endsWith("\n") ? out.slice(0, -1) : out;
  const rows: string[] = [];
  for (let i = 0; i < body.length; i += width) {
    rows.push(body.slice(i, i + width));
  }
  return rows;
}

describe("text-buffer-168 render style (backward-compat alias)", () => {
  it("returns a flat 8×21 buffer", () => {
    const out = textBuffer168.render({});
    expect(typeof out).toBe("string");
    const rows = rowsOf(out as string, LINE_WIDTH);
    expect(rows).toHaveLength(LINE_COUNT);
    for (const row of rows) expect(row).toHaveLength(LINE_WIDTH);
  });

  it("renders each entry as KEY VALUE padded to 21 chars", () => {
    const out = textBuffer168.render({ ALT: 12_345 }) as string;
    const rows = rowsOf(out, LINE_WIDTH);
    expect(rows[0]).toBe("ALT 12345".padEnd(LINE_WIDTH, " "));
    for (let i = 1; i < LINE_COUNT; i++) expect(rows[i]).toBe(BLANK);
  });

  it("formats booleans as ON/OFF", () => {
    const out = textBuffer168.render({ SAS: true, RCS: false }) as string;
    const rows = rowsOf(out, LINE_WIDTH);
    expect(rows[0]).toBe(padTo("RCS OFF"));
    expect(rows[1]).toBe(padTo("SAS ON"));
  });

  it("rounds non-integer numbers to 2 decimal places", () => {
    const out = textBuffer168.render({ q: 0.1234 }) as string;
    expect(rowsOf(out, LINE_WIDTH)[0]).toBe(padTo("q 0.12"));
  });

  it("sorts entries by key for determinism", () => {
    const out1 = textBuffer168.render({ b: 1, a: 2 }) as string;
    const out2 = textBuffer168.render({ a: 2, b: 1 }) as string;
    expect(out1).toBe(out2);
    expect(rowsOf(out1, LINE_WIDTH)[0]).toBe(padTo("a 2"));
  });

  it("drops entries beyond the 8th", () => {
    const merged: Record<string, number> = {};
    for (let i = 0; i < 12; i++) merged[`k${String(i).padStart(2, "0")}`] = i;
    const rows = rowsOf(textBuffer168.render(merged) as string, LINE_WIDTH);
    expect(rows).toHaveLength(LINE_COUNT);
    // Last visible row should be k07 (8th in sorted order), not k11.
    expect(rows[7]).toBe(padTo("k07 7"));
  });

  it("truncates long lines to 21 chars", () => {
    const out = textBuffer168.render({
      LONG_KEY_NAME_FOR_TESTING: 42,
    }) as string;
    const first = rowsOf(out, LINE_WIDTH)[0];
    expect(first).toHaveLength(LINE_WIDTH);
    expect(first.startsWith("LONG_KEY_NAME_FOR_TES")).toBe(true);
  });
});

function padTo(s: string): string {
  return s.padEnd(LINE_WIDTH, " ");
}

describe("text-buffer render style (parameterised)", () => {
  it("defaults to 21×8 when no config is provided", () => {
    const out = textBuffer.render({}) as string;
    const rows = rowsOf(out, 21);
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row).toHaveLength(21);
  });

  it("uses config.w / config.h when provided", () => {
    const out = textBuffer.render(
      { A: 1, B: 2, C: 3, D: 4, E: 5 },
      {
        w: 10,
        h: 4,
      },
    ) as string;
    const rows = rowsOf(out, 10);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(10);
    // E is dropped, only 4 rows.
    expect(rows[0]).toBe("A 1".padEnd(10, " "));
    expect(rows[3]).toBe("D 4".padEnd(10, " "));
  });

  it("ignores non-numeric / zero / negative dimensions and falls back to defaults", () => {
    const a = textBuffer.render({}, { w: 0, h: -3 }) as string;
    const b = textBuffer.render({}, { w: "nope", h: null }) as string;
    const aRows = rowsOf(a, 21);
    const bRows = rowsOf(b, 21);
    expect(aRows).toHaveLength(8);
    for (const row of aRows) expect(row).toHaveLength(21);
    expect(bRows[0]).toHaveLength(21);
  });

  it("floors fractional dimensions", () => {
    const out = textBuffer.render({}, { w: 5.9, h: 3.1 }) as string;
    const rows = rowsOf(out, 5);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(5);
  });
});
