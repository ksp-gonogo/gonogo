import { getComponents } from "@ksp-gonogo/core";
import { gridFloor, showsTiny, TINY_SIZE } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import "../src";

/**
 * Every registered widget's sizes obey the one rule: `minSize` is where its own
 * body stops fitting, a widget with a tiny mode draws the tiny form below it and
 * stops at the kit-wide tiny size, and a widget without one stops at `minSize`.
 */
describe("every registered widget's sizes", () => {
  const defs = getComponents();

  it("walks a real registry", () => {
    expect(defs.length).toBeGreaterThanOrEqual(30);
    expect(defs.filter((d) => d.tiny !== undefined).length).toBeGreaterThan(10);
  });

  it("put a tiny widget's grid floor at the tiny size", () => {
    const wrong = defs
      .filter((d) => d.tiny !== undefined)
      .filter((d) => {
        const floor = gridFloor(d);
        return floor?.w !== TINY_SIZE.w || floor?.h !== TINY_SIZE.h;
      })
      .map((d) => `${d.id} floors at ${JSON.stringify(gridFloor(d))}`);
    expect(wrong).toEqual([]);
  });

  it("let a tiny widget's minSize exceed the tiny size, so its tiny form is seen", () => {
    const wrong = defs
      .filter((d) => d.tiny !== undefined)
      .filter((d) => {
        const min = d.minSize;
        if (!min) return false;
        return (
          min.w < TINY_SIZE.w ||
          min.h < TINY_SIZE.h ||
          (min.w === TINY_SIZE.w && min.h === TINY_SIZE.h)
        );
      })
      .map((d) => `${d.id} minSize ${d.minSize?.w}x${d.minSize?.h}`);
    expect(wrong).toEqual([]);
  });

  it("draw a tiny widget's tiny form at the tiny size and its body at minSize", () => {
    const wrong: string[] = [];
    for (const d of defs.filter((x) => x.tiny !== undefined)) {
      const min = d.minSize ?? { w: 5, h: 4 };
      if (!showsTiny(d, TINY_SIZE.w, TINY_SIZE.h)) {
        wrong.push(`${d.id} shows its body at the tiny size`);
      }
      if (showsTiny(d, min.w, min.h)) {
        wrong.push(`${d.id} shows its tiny form at its minSize`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("place defaultSize at or above minSize", () => {
    const wrong = defs
      .filter((d) => d.minSize && d.defaultSize)
      .filter(
        (d) =>
          (d.defaultSize?.w ?? 0) < (d.minSize?.w ?? 0) ||
          (d.defaultSize?.h ?? 0) < (d.minSize?.h ?? 0),
      )
      .map((d) => d.id);
    expect(wrong).toEqual([]);
  });
});
