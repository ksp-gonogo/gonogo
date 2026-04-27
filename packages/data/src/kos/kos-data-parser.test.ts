import { describe, expect, it } from "vitest";
import { parseKosData } from "./kos-data-parser";

describe("parseKosData", () => {
  it("returns null when there's no [KOSDATA] block", () => {
    expect(parseKosData("")).toBeNull();
    expect(parseKosData("kOS> ")).toBeNull();
    expect(parseKosData("Program ended.")).toBeNull();
  });

  it("returns null when the closing tag is missing", () => {
    // Partial chunk before [/KOSDATA] arrives — data source should wait.
    expect(parseKosData("[KOSDATA] x=1")).toBeNull();
  });

  it("parses a simple single-key block", () => {
    expect(parseKosData("[KOSDATA] x=1 [/KOSDATA]")).toEqual({ x: 1 });
  });

  it("parses multiple keys separated by ;", () => {
    expect(
      parseKosData(
        "[KOSDATA] alt=1234.5;heading=90;burning=true;name=stage1 [/KOSDATA]",
      ),
    ).toEqual({ alt: 1234.5, heading: 90, burning: true, name: "stage1" });
  });

  it("coerces numbers including negatives, floats, and scientific notation", () => {
    const data = parseKosData(
      "[KOSDATA] a=0;b=-1.5;c=3e-2;d=.25;e=42 [/KOSDATA]",
    );
    expect(data).toEqual({ a: 0, b: -1.5, c: 0.03, d: 0.25, e: 42 });
  });

  it("coerces exactly lowercase true/false to booleans", () => {
    expect(
      parseKosData("[KOSDATA] a=true;b=false;c=True;d=FALSE [/KOSDATA]"),
    ).toEqual({ a: true, b: false, c: "True", d: "FALSE" });
  });

  it("leaves non-numeric non-boolean values as strings", () => {
    expect(parseKosData("[KOSDATA] s=hello;e=;n=NaN [/KOSDATA]")).toEqual({
      s: "hello",
      e: "",
      n: "NaN",
    });
  });

  it("splits each pair on the first = so values can contain =", () => {
    expect(parseKosData("[KOSDATA] expr=a=b=c [/KOSDATA]")).toEqual({
      expr: "a=b=c",
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseKosData("[KOSDATA]   a =  1  ;  b = hi   [/KOSDATA]")).toEqual({
      a: 1,
      b: "hi",
    });
  });

  it("skips malformed pairs with no = and empty keys", () => {
    expect(parseKosData("[KOSDATA] a=1;nokey;=orphan;b=2 [/KOSDATA]")).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("ignores surrounding REPL noise and returns only the block's data", () => {
    const chunk = [
      "Terminal: type = XTERM-256COLOR",
      "RUN deltav(1234).",
      "Starting…",
      "[KOSDATA] dv=2450;stage=2 [/KOSDATA]",
      "Program ended.",
      "kOS> ",
    ].join("\n");
    expect(parseKosData(chunk)).toEqual({ dv: 2450, stage: 2 });
  });

  it("returns the LAST block when multiple are present in the same chunk", () => {
    const chunk = "[KOSDATA] v=1 [/KOSDATA]\nkOS> [KOSDATA] v=2 [/KOSDATA]";
    expect(parseKosData(chunk)).toEqual({ v: 2 });
  });

  it("handles a block whose body spans multiple lines", () => {
    // kOS output can carry CR/LF — BLOCK_RE uses [\s\S] to span lines.
    const chunk = "[KOSDATA] a=1;\nb=2 [/KOSDATA]";
    expect(parseKosData(chunk)).toEqual({ a: 1, b: 2 });
  });

  it("is safe to call repeatedly (regex lastIndex is reset per call)", () => {
    const chunk = "[KOSDATA] a=1 [/KOSDATA]";
    expect(parseKosData(chunk)).toEqual({ a: 1 });
    expect(parseKosData(chunk)).toEqual({ a: 1 });
    expect(parseKosData(chunk)).toEqual({ a: 1 });
  });

  it("returns an empty object for an empty body", () => {
    expect(parseKosData("[KOSDATA]  [/KOSDATA]")).toEqual({});
  });

  it("parses through ANSI cursor-position escapes that wrap kOS output", () => {
    // Real-world capture: kOS's GUI repaint emits the screen contents
    // with `ESC [ row ; col H` injected at every PTY-width line wrap.
    // Long PRINT output gets split across rows, breaking literal marker
    // matches like `[/KOSDA<ESC[22;1H>TA]`. The parser must ignore
    // these escapes when locating the block AND when reading the body.
    const wrapped =
      '\x1b[1;1Hparts=[{"uid":"123","name":"Stratus[2;1H"}][/KOSDA[22;1HTA][23;1HProgram ended.';
    const chunk = `[KOSDATA]${wrapped}`;
    expect(parseKosData(chunk)).toMatchObject({
      // The inner ANSI between value chars survives as part of the string;
      // that's fine for shipmap (it parses parts as JSON afterwards).
      // What matters is that the marker pair was found at all.
      parts: expect.stringContaining('{"uid":"123"'),
    });
  });

  it("strips an OSC SET TITLE sequence so the marker scan still works", () => {
    const chunk =
      "\x1b]2;Hopper CPU\x07[KOSDATA] dv=1234 [/KOSDATA]\x1b]2;Hopper CPU\x07";
    expect(parseKosData(chunk)).toEqual({ dv: 1234 });
  });
});
