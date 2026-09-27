import { describe, expect, it } from "vitest";
import type { ScenePayload, SceneReport } from "../render-probe";
import { UNANNOUNCED_MARK } from "./probe-global";
import type { Scene } from "./scenes";
import {
  judgeStaleness,
  mountForStaleness,
  multisetMinus,
  type StalenessStage,
} from "./staleness";

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

describe("a staleness render of a scene driven by presses", () => {
  /**
   * A plan composer: bare until "Save plan" is pressed, then a countdown that
   * is marked held once the link drops. The drop is applied when the probe
   * would apply it: inside the mount, unless the mount holds it for `finish`.
   */
  function composer(log: string[]): StalenessStage {
    let saved = false;
    let connected = true;
    let pendingDrop = false;
    const report = (): SceneReport => ({
      visibleText: "",
      boxCount: 1,
      signature: "",
      elements: saved
        ? [connected ? figure(3) : held(3)]
        : ["<p> Nothing saved"],
      uncarriedTopics: [],
      unsubscribedTopics: [],
    });
    return {
      mount: async (payload) => {
        log.push("mount");
        saved = false;
        connected = true;
        pendingDrop =
          payload.stopsArriving === true && payload.holdDrop === true;
        if (payload.stopsArriving && !pendingDrop) {
          log.push("drop");
          connected = false;
        }
        return report();
      },
      act: async (_scene, missing) => {
        log.push(`act:${missing}`);
        saved = true;
      },
      refeed: async () => {
        log.push("refeed");
      },
      finish: async () => {
        if (pendingDrop) {
          log.push("drop");
          connected = false;
          pendingDrop = false;
        }
        return report();
      },
      read: async () => report(),
    };
  }

  const scene = (steps?: Scene["steps"], stopsArriving?: boolean): Scene => ({
    file: "composer.json",
    name: "composer-delayed",
    target: { kind: "widget", id: "composer" },
    paints: [],
    before: [{ press: "Save plan" }],
    pinnedUt: 0,
    emits: [],
    config: {},
    slotProps: {},
    dataSources: {},
    carriedChannels: [],
    modes: [],
    steps,
    stopsArriving,
    motion: { fps: 10, pingPong: false },
  });

  const payload = (stopsArriving: boolean, withheld = false): ScenePayload => ({
    target: { kind: "widget", id: "composer" },
    fixture: "composer-delayed",
    pinnedUt: 0,
    carriedChannels: [],
    emits: [],
    stopsArriving,
    withhold: withheld ? { kind: "augment", id: "guest" } : undefined,
    config: {},
    slotProps: {},
    dataSources: {},
    w: 1,
    h: 1,
    pxW: 1,
    pxH: 1,
    starve: false,
  });

  it("judges the pressed state, and marks it held once the link drops", async () => {
    const log: string[] = [];
    const stage = composer(log);
    const live = await mountForStaleness(stage, scene(), payload(false));
    const stale = await mountForStaleness(stage, scene(), payload(true));
    expect(live.elements).toEqual([figure(3)]);
    const verdict = judgeStaleness({
      live: live.elements,
      stale: stale.elements,
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.differences).toEqual([`- ${figure(3)}`, `+ ${held(3)}`]);
    expect(log.slice(-4)).toEqual(["mount", "act:throw", "refeed", "drop"]);
  });

  it("does not refeed a motion scene, whose film starts before the refeed", async () => {
    const log: string[] = [];
    await mountForStaleness(
      composer(log),
      scene([{ waitMs: 100 }]),
      payload(true),
    );
    expect(log).toEqual(["mount", "act:throw", "drop"]);
  });

  it("drops before the presses for a scene that stages the drop, as its picture does", async () => {
    const log: string[] = [];
    await mountForStaleness(
      composer(log),
      scene(undefined, true),
      payload(true),
    );
    expect(log).toEqual(["mount", "drop", "act:throw", "refeed"]);
  });

  it("skips a press the withheld guest would have drawn", async () => {
    const log: string[] = [];
    await mountForStaleness(composer(log), scene(), payload(true, true));
    expect(log).toContain("act:skip");
  });
});
