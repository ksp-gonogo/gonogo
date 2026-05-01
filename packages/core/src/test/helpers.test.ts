import { describe, expect, it } from "vitest";
import { memoryStorage } from "./helpers";

describe("memoryStorage", () => {
  it("round-trips values via setItem/getItem", () => {
    const s = memoryStorage();
    s.setItem("a", "1");
    s.setItem("b", "two");
    expect(s.getItem("a")).toBe("1");
    expect(s.getItem("b")).toBe("two");
  });

  it("returns null for missing keys", () => {
    const s = memoryStorage();
    expect(s.getItem("missing")).toBeNull();
  });

  it("coerces non-string values to strings on setItem", () => {
    const s = memoryStorage();
    // Storage.setItem accepts string, but the spec coerces — match that.
    s.setItem("n", 42 as unknown as string);
    expect(s.getItem("n")).toBe("42");
  });

  it("removeItem deletes a key", () => {
    const s = memoryStorage();
    s.setItem("k", "v");
    s.removeItem("k");
    expect(s.getItem("k")).toBeNull();
  });

  it("clear empties the store", () => {
    const s = memoryStorage();
    s.setItem("a", "1");
    s.setItem("b", "2");
    s.clear();
    expect(s.getItem("a")).toBeNull();
    expect(s.getItem("b")).toBeNull();
  });

  it("reports length as 0 and key() as null (documented limitation)", () => {
    const s = memoryStorage();
    s.setItem("a", "1");
    // The shim does not implement these — guard the behaviour so any future
    // change is intentional.
    expect(s.length).toBe(0);
    expect(s.key(0)).toBeNull();
  });

  it("isolates separate instances", () => {
    const a = memoryStorage();
    const b = memoryStorage();
    a.setItem("k", "1");
    expect(b.getItem("k")).toBeNull();
  });
});
