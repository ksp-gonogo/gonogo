import { describe, expect, it } from "vitest";
import { normaliseReactIds } from "./widgetDomSnapshot";

/**
 * Part of the comparison behind the behavior-preservation dual-run goldens, so a
 * defect here does not fail a test, it stops tests from failing. The
 * normalisation has to absorb a counter shift while still reporting mis-wired
 * aria references.
 */
describe("normaliseReactIds", () => {
  it("makes the same tree compare equal when the id counter has shifted", () => {
    const early = `<button aria-controls=":r3:panel" /><div id=":r3:panel" />`;
    const late = `<button aria-controls=":r7:panel" /><div id=":r7:panel" />`;
    expect(normaliseReactIds(early)).toBe(normaliseReactIds(late));
  });

  it("still reports a control pointing at the wrong panel", () => {
    // The failure a blanket replace would have hidden: both trees mention two
    // ids, and only the referencing edge differs.
    const wired = `<button aria-controls=":r3:" /><div id=":r3:" /><div id=":r4:" />`;
    const mixed = `<button aria-controls=":r4:" /><div id=":r3:" /><div id=":r4:" />`;
    expect(normaliseReactIds(wired)).not.toBe(normaliseReactIds(mixed));
  });

  it("keeps distinct ids distinct rather than collapsing them to one token", () => {
    const html = normaliseReactIds(`<div id=":r3:" /><div id=":r4:" />`);
    expect(html).toBe(`<div id=":rid0:" /><div id=":rid1:" />`);
  });
});
