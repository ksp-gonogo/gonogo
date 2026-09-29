import { describe, expect, it } from "vitest";
import type { ScenePayload, SceneReport } from "../render-probe";
import { type HeldStage, judgeHeld, mountForHeld, multisetMinus } from "./held";
import { UNANNOUNCED_MARK } from "./probe-global";
import type { Scene } from "./scenes";

const figure = (n: number) => `<span class="v"> ${n}`;
const held = (n: number) =>
  `<span class="v" data-held="" title="OFFLINE"> ${n}`;
const wrapper = (cls: string) => `<div class="${cls}"> `;

describe("multisetMinus", () => {
  it("takes one line away per line taken, so a repeat survives", () => {
    expect(multisetMinus(["a", "a", "b"], ["a"])).toEqual(["a", "b"]);
  });
});

describe("judgeHeld on a widget", () => {
  it("calls a render that does not move unchanged", () => {
    const lines = [figure(1), figure(2)];
    const verdict = judgeHeld({ live: lines, held: [...lines] });
    expect(verdict.unchanged).toBe(true);
    expect(verdict.changed).toBe(0);
  });

  it("sees a figure that gains the held mark", () => {
    const verdict = judgeHeld({
      live: [figure(1), figure(2)],
      held: [figure(1), held(2)],
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.differences).toEqual([`- ${figure(2)}`, `+ ${held(2)}`]);
  });

  it("does not count a layout box that appears on one side only", () => {
    const verdict = judgeHeld({
      live: [figure(1)],
      held: [figure(1), wrapper("extra")],
    });
    expect(verdict.unchanged).toBe(true);
  });

  it("counts a box restyled between the two, which is a dimmed panel", () => {
    const verdict = judgeHeld({
      live: [wrapper("lit"), figure(1)],
      held: [wrapper("dim"), figure(1)],
    });
    expect(verdict.unchanged).toBe(false);
  });

  it("names a held mark drawn with no caption", () => {
    const silent = `${held(3)} ${UNANNOUNCED_MARK}`;
    const verdict = judgeHeld({
      live: [figure(3)],
      held: [silent],
    });
    expect(verdict.unannounced).toEqual([silent]);
  });
});

describe("judgeHeld on a guest inside a host", () => {
  const hostLive = [`<header> Crew`, figure(10)];
  const hostHeld = [`<header> Crew · held`, held(10)];

  it("fails a guest that ignores the drop while its host marks itself", () => {
    const guest = `<span class="badge"> ~4min to fatal`;
    const verdict = judgeHeld({
      live: [...hostLive, guest],
      held: [...hostHeld, guest],
      hostOnly: { live: hostLive, held: hostHeld },
    });
    expect(verdict.unchanged).toBe(true);
    expect(verdict.drawn).toEqual({ live: 1, held: 1 });
  });

  it("passes a guest that marks its own figure", () => {
    const verdict = judgeHeld({
      live: [...hostLive, `<span class="badge"> ~4min to fatal`],
      held: [...hostHeld, `<span class="badge"> ~4min to fatal · held`],
      hostOnly: { live: hostLive, held: hostHeld },
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.changed).toBe(2);
  });

  it("reports a guest that draws nothing here as drawing nothing", () => {
    const verdict = judgeHeld({
      live: hostLive,
      held: hostHeld,
      hostOnly: { live: hostLive, held: hostHeld },
    });
    expect(verdict.drawn).toEqual({ live: 0, held: 0 });
  });
});

describe("a held render of a scene driven by presses", () => {
  /**
   * A plan composer: bare until "Save plan" is pressed, then a countdown that
   * is marked held once the link drops. The drop is applied when the probe
   * would apply it: inside the mount, unless the mount holds it for `finish`.
   */
  function composer(log: string[]): HeldStage {
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
      undeclaredTopics: [],
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
    hero: false,
    paints: [],
    before: [{ press: "Save plan" }],
    pinnedUt: 0,
    emits: [],
    config: {},
    slotProps: {},
    dataSources: {},
    declaredTopics: [],
    modes: [],
    steps,
    stopsArriving,
    motion: { fps: 10, pingPong: false },
  });

  const payload = (stopsArriving: boolean, withheld = false): ScenePayload => ({
    target: { kind: "widget", id: "composer" },
    fixture: "composer-delayed",
    pinnedUt: 0,
    emits: [],
    stopsArriving,
    withhold: withheld ? { kind: "augment", id: "guest" } : undefined,
    config: {},
    slotProps: {},
    dataSources: {},
    declaredTopics: [],
    w: 1,
    h: 1,
    pxW: 1,
    pxH: 1,
    starve: false,
  });

  it("judges the pressed state, and marks it held once the link drops", async () => {
    const log: string[] = [];
    const stage = composer(log);
    const live = await mountForHeld(stage, scene(), payload(false));
    const dropped = await mountForHeld(stage, scene(), payload(true));
    expect(live.elements).toEqual([figure(3)]);
    const verdict = judgeHeld({
      live: live.elements,
      held: dropped.elements,
    });
    expect(verdict.unchanged).toBe(false);
    expect(verdict.differences).toEqual([`- ${figure(3)}`, `+ ${held(3)}`]);
    expect(log.slice(-4)).toEqual(["mount", "act:throw", "refeed", "drop"]);
  });

  it("does not refeed a motion scene, whose film starts before the refeed", async () => {
    const log: string[] = [];
    await mountForHeld(composer(log), scene([{ waitMs: 100 }]), payload(true));
    expect(log).toEqual(["mount", "act:throw", "drop"]);
  });

  it("drops before the presses for a scene that stages the drop, as its picture does", async () => {
    const log: string[] = [];
    await mountForHeld(composer(log), scene(undefined, true), payload(true));
    expect(log).toEqual(["mount", "drop", "act:throw", "refeed"]);
  });

  it("skips a press the withheld guest would have drawn", async () => {
    const log: string[] = [];
    await mountForHeld(composer(log), scene(), payload(true, true));
    expect(log).toContain("act:skip");
  });
});
