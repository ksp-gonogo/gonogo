// @vitest-environment node
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RENDER_STEP_TIMEOUT_MS,
  type RenderOptions,
  renderOneScene,
  within,
} from "./driver";
import type { Scene } from "./scenes";

afterEach(() => {
  vi.useRealTimers();
});

const scene: Scene = {
  file: "breaking-ground-absent.json",
  name: "breaking-ground-absent",
  target: { kind: "widget", id: "deployed-science" },
  hero: false,
  paints: [],
  before: [],
  pinnedUt: 0,
  emits: [],
  config: {},
  slotProps: {},
  dataSources: {},
  declaredTopics: [],
  modes: [{ name: "default", w: 4, h: 4, pxW: 400, pxH: 400 }],
  motion: { fps: 12, pingPong: false },
};

/** Only `evaluate` is ever reached before the mount gives up. */
const stuckTab = new Proxy({} as Page, {
  get: (_, member) =>
    member === "evaluate" ? () => new Promise(() => {}) : undefined,
});

describe("a scene that never mounts", () => {
  it("fails within the limit, naming the Uplink, widget, scene and engine", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const opts = { engine: "firefox", outDir: "unused", frames: false };
    const run = renderOneScene(
      stuckTab,
      scene,
      opts as RenderOptions,
      [],
      { guests: [], judged: new Set(), hostSlots: new Map() },
      "breaking-ground",
    );
    const failure = expect(run).rejects.toThrow(
      /mounting the scene did not finish within 60 seconds[\s\S]*Uplink breaking-ground, widget deployed-science, scene breaking-ground-absent, engine firefox/,
    );
    await vi.advanceTimersByTimeAsync(RENDER_STEP_TIMEOUT_MS);
    await failure;
  });

  it("lets work that finishes in time through and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(within("a step", Promise.resolve(7))).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});
