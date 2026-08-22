import { describe, expect, it } from "vitest";
import { parseScriptArgs } from "./args";

describe("parseScriptArgs", () => {
  it("returns no args for empty or whitespace-only input", () => {
    expect(parseScriptArgs("")).toEqual([]);
    expect(parseScriptArgs("   ")).toEqual([]);
  });

  it("infers numbers, including negatives and decimals", () => {
    expect(parseScriptArgs("5")).toEqual([5]);
    expect(parseScriptArgs("-3.5 42")).toEqual([-3.5, 42]);
  });

  it("infers booleans regardless of case", () => {
    expect(parseScriptArgs("true FALSE True")).toEqual([true, false, true]);
  });

  it("keeps anything else as a string", () => {
    expect(parseScriptArgs("hello 0:/foo.ks")).toEqual(["hello", "0:/foo.ks"]);
  });

  it("collapses runs of whitespace between tokens", () => {
    expect(parseScriptArgs("  1   two  3 ")).toEqual([1, "two", 3]);
  });

  it("does not treat a bare word as the number zero", () => {
    // Number("") and Number(" ") are 0; the parser must not let an empty
    // fragment leak through as a numeric arg.
    expect(parseScriptArgs("abc")).toEqual(["abc"]);
  });
});
