import { describe, expect, it } from "vitest";
import { normaliseReactIds } from "./widgetDomSnapshot";

/** The normalisation behind the dual-run goldens absorbs a counter shift while still reporting mis-wired aria references. A defect here stops other tests from failing. */
describe("normaliseReactIds", () => {
  it("makes the same tree compare equal when the id counter has shifted", () => {
    const early = `<button aria-controls=":r3:panel" /><div id=":r3:panel" />`;
    const late = `<button aria-controls=":r7:panel" /><div id=":r7:panel" />`;
    expect(normaliseReactIds(early)).toBe(normaliseReactIds(late));
  });

  it("still reports a control pointing at the wrong panel", () => {
    // Both trees mention two ids and only the referencing edge differs, which a blanket replace would hide.
    const wired = `<button aria-controls=":r3:" /><div id=":r3:" /><div id=":r4:" />`;
    const mixed = `<button aria-controls=":r4:" /><div id=":r3:" /><div id=":r4:" />`;
    expect(normaliseReactIds(wired)).not.toBe(normaliseReactIds(mixed));
  });

  it("keeps distinct ids distinct rather than collapsing them to one token", () => {
    const html = normaliseReactIds(`<div id=":r3:" /><div id=":r4:" />`);
    expect(html).toBe(`<div id=":rid0:" /><div id=":rid1:" />`);
  });
});
