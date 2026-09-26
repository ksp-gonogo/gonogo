import { describe, expect, it } from "vitest";
import { UNANNOUNCED_MARK } from "./probe-global";
import { judgeStaleness, multisetMinus } from "./staleness";

const figure = (n: number) => `<span class="v"> ${n}`;
const held = (n: number) =>
  `<span class="v" data-not-current="" title="OFFLINE"> ${n}`;
const wrapper = (cls: string) => `<div class="${cls}"> `;

describe("multisetMinus", () => {
  it("takes one line away per line taken, so a repeat survives", () => {
    expect(multisetMinus(["a", "a", "b"], ["a"])).toEqual(["a", "b"]);
  });
});

describe("judgeStaleness on a widget", () => {
  it("calls a render that does not move unchanged", () => {
    const lines = [figure(1), figure(2)];
    const verdict = judgeStaleness({ live: lines, stale: [...lines] });
    expect(verdict.unchanged).toBe(true);
    expect(verdict.changed).toBe(0);
  });

  it("sees a figure that gains the held mark", () => {
    const verdict = judgeStaleness({
      live: [figure(1), figure(2)],
      stale: [figure(1), held(2)],
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.differences).toEqual([`- ${figure(2)}`, `+ ${held(2)}`]);
  });

  it("does not count a layout box that appears on one side only", () => {
    const verdict = judgeStaleness({
      live: [figure(1)],
      stale: [figure(1), wrapper("extra")],
    });
    expect(verdict.unchanged).toBe(true);
  });

  it("counts a box restyled between the two, which is a dimmed panel", () => {
    const verdict = judgeStaleness({
      live: [wrapper("lit"), figure(1)],
      stale: [wrapper("dim"), figure(1)],
    });
    expect(verdict.unchanged).toBe(false);
  });

  it("names a held mark drawn with no caption", () => {
    const silent = `${held(3)} ${UNANNOUNCED_MARK}`;
    const verdict = judgeStaleness({
      live: [figure(3)],
      stale: [silent],
    });
    expect(verdict.unannounced).toEqual([silent]);
  });
});

describe("judgeStaleness on a guest inside a host", () => {
  const hostLive = [`<header> Crew`, figure(10)];
  const hostStale = [`<header> Crew · held`, held(10)];

  it("fails a guest that ignores the drop while its host marks itself", () => {
    const guest = `<span class="badge"> ~4min to fatal`;
    const verdict = judgeStaleness({
      live: [...hostLive, guest],
      stale: [...hostStale, guest],
      hostOnly: { live: hostLive, stale: hostStale },
    });
    expect(verdict.unchanged).toBe(true);
    expect(verdict.drawn).toEqual({ live: 1, stale: 1 });
  });

  it("passes a guest that marks its own figure", () => {
    const verdict = judgeStaleness({
      live: [...hostLive, `<span class="badge"> ~4min to fatal`],
      stale: [...hostStale, `<span class="badge"> ~4min to fatal · held`],
      hostOnly: { live: hostLive, stale: hostStale },
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.changed).toBe(2);
  });

  it("reports a guest that draws nothing here as drawing nothing", () => {
    const verdict = judgeStaleness({
      live: hostLive,
      stale: hostStale,
      hostOnly: { live: hostLive, stale: hostStale },
    });
    expect(verdict.drawn).toEqual({ live: 0, stale: 0 });
  });
});
