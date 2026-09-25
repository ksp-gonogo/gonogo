import { describe, expect, it } from "vitest";
import { isValue, value } from "../unit-system/value";
import { shareEqual } from "./share-equal";

function field(record: unknown, key: string): unknown {
  return typeof record === "object" && record !== null
    ? Reflect.get(record, key)
    : undefined;
}

describe("shareEqual", () => {
  it("returns the previous record when the next one is equal throughout", () => {
    const previous = { a: 1, b: [1, 2, { c: "x" }], d: value("m", 5) };
    const next = { a: 1, b: [1, 2, { c: "x" }], d: value("m", 5) };

    expect(shareEqual(previous, next)).toBe(previous);
  });

  it("keeps the unchanged branches of a record that moved", () => {
    const previous = { moved: 1, kept: { deep: [1, 2] } };
    const shared = shareEqual(previous, { moved: 2, kept: { deep: [1, 2] } });

    expect(shared).not.toBe(previous);
    expect(shared).toEqual({ moved: 2, kept: { deep: [1, 2] } });
    expect(field(shared, "kept")).toBe(previous.kept);
  });

  it("treats a key that appeared or vanished as a change", () => {
    const previous = { a: 1 };

    expect(shareEqual(previous, { a: 1, b: undefined })).not.toBe(previous);
    expect(shareEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
  });

  it("keeps the equal elements of an array that grew", () => {
    const first = { id: 1 };
    const shared = shareEqual([first], [{ id: 1 }, { id: 2 }]);

    expect(shared).toEqual([{ id: 1 }, { id: 2 }]);
    expect(field(shared, "0")).toBe(first);
  });

  it("compares a Value by magnitude and unit, and keeps a moved one's arithmetic", () => {
    const previous = value("m", 5);

    expect(shareEqual(previous, value("m", 5))).toBe(previous);
    expect(shareEqual(previous, value("km", 5))).not.toBe(previous);
    const moved = shareEqual(previous, value("m", 6));
    if (!isValue(moved))
      throw new Error("a moved Value came back as something else");
    expect(moved.plus(value("m", 1)).equals(value("m", 7))).toBe(true);
  });

  it("reads a plain record that happens to carry a magnitude and unit as a record", () => {
    const previous = { magnitude: 1, unit: "m", label: "a" };

    expect(
      shareEqual(previous, { magnitude: 1, unit: "m", label: "b" }),
    ).toEqual({ magnitude: 1, unit: "m", label: "b" });
  });

  it("holds NaN equal to NaN, so a non-finite field does not churn", () => {
    const previous = { x: Number.NaN };

    expect(shareEqual(previous, { x: Number.NaN })).toBe(previous);
  });

  it("does not look inside an object that is not plain data", () => {
    const previous = { m: new Map([["a", 1]]) };

    expect(shareEqual(previous, { m: new Map([["a", 1]]) })).not.toBe(previous);
  });

  it("answers null and undefined as themselves", () => {
    expect(shareEqual({ a: 1 }, null)).toBeNull();
    expect(shareEqual(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(shareEqual(null, null)).toBeNull();
  });
});
