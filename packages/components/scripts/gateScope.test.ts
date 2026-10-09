// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scopeWidgets, shardFlag, widgetFlag } from "./gateScope";
import type { WidgetRenderConfig } from "./widgetRenderHarness";
import { listWidgets } from "./widgets";

function config(fixturesPath: string): WidgetRenderConfig {
  return { widgetId: "w", fixturesPath, outPath: "o", modes: [] };
}

const CONFIGS = [
  config("LandingStatus/__render__"),
  config("LandingStatus/__render_currency__"),
  config("Navball/__fixtures__"),
  config("NavballExtras/__fixtures__"),
];

describe("widgetFlag", () => {
  it("is absent without the flag", () => {
    expect(widgetFlag(["--other"])).toBeUndefined();
  });

  it("reads one directory, several, and the = spelling", () => {
    expect(widgetFlag(["--widget", "Navball"])).toEqual(["Navball"]);
    expect(widgetFlag(["--widget", "Navball, LandingStatus"])).toEqual([
      "Navball",
      "LandingStatus",
    ]);
    expect(widgetFlag(["--widget=Navball"])).toEqual(["Navball"]);
  });

  it("reads a flag with no value as no directories", () => {
    expect(widgetFlag(["--widget"])).toEqual([]);
  });
});

describe("scopeWidgets", () => {
  it("keeps the configs whose fixtures sit under the directory, and not a longer name that starts with it", () => {
    const { widgets, refusal } = scopeWidgets(CONFIGS, ["Navball"], "g", 30);
    expect(widgets.map((w) => w.fixturesPath)).toEqual([
      "Navball/__fixtures__",
    ]);
    expect(refusal).toBeNull();
  });

  it("unions several directories", () => {
    const { widgets } = scopeWidgets(
      CONFIGS,
      ["Navball", "LandingStatus"],
      "g",
      30,
    );
    expect(widgets).toHaveLength(3);
  });

  it("drops the floor once something matched", () => {
    expect(scopeWidgets(CONFIGS, ["Navball"], "g", 30).refusal).toBeNull();
  });

  it("refuses a scope that matches nothing, however the floor is set", () => {
    const { widgets, refusal } = scopeWidgets(CONFIGS, ["Nope"], "g", 0);
    expect(widgets).toEqual([]);
    expect(refusal).toContain("g: no render config has fixtures under");
    expect(scopeWidgets(CONFIGS, [], "g", 0).refusal).not.toBeNull();
  });

  it("holds the floor without the flag, with the message the gates always gave", () => {
    const { widgets, refusal } = scopeWidgets(CONFIGS, undefined, "g", 30);
    expect(widgets).toBe(CONFIGS);
    expect(refusal).toBe(
      "\ng: only 4 widget config(s) found, expected at least 30. Refusing to report a clean run over a set this small.",
    );
  });

  it("passes the whole set without the flag when it clears the floor", () => {
    expect(scopeWidgets(CONFIGS, undefined, "g", 4).refusal).toBeNull();
  });

  it("finds the real Landing Status and Navball configs by their directory", () => {
    const all = listWidgets();
    expect(
      scopeWidgets(all, ["LandingStatus"], "g", 30).widgets.length,
    ).toBeGreaterThan(0);
    expect(
      scopeWidgets(all, ["Navball"], "g", 30).widgets.length,
    ).toBeGreaterThan(0);
  });
});

describe("shardFlag", () => {
  it("is absent without the flag", () => {
    expect(shardFlag(["--widget", "Navball"])).toBeUndefined();
  });

  it("reads both spellings", () => {
    expect(shardFlag(["--shard", "2/4"])).toEqual({ index: 2, count: 4 });
    expect(shardFlag(["--shard=3/3"])).toEqual({ index: 3, count: 3 });
  });

  it.each(["", "2", "0/4", "5/4", "a/b"])("rejects %j", (raw) => {
    expect(() => shardFlag(["--shard", raw])).toThrow("--shard takes");
  });
});

describe("scopeWidgets sharding", () => {
  const many = Array.from({ length: 10 }, (_, i) => config(`W${i}/__f__`));

  it("covers every config in exactly one shard", () => {
    const seen = [1, 2, 3].flatMap((index) =>
      scopeWidgets(many, undefined, "g", 10, { index, count: 3 }).widgets.map(
        (w) => w.fixturesPath,
      ),
    );
    expect(seen.sort()).toEqual(many.map((w) => w.fixturesPath).sort());
  });

  it("holds the floor on the whole set, not the slice", () => {
    expect(
      scopeWidgets(many, undefined, "g", 10, { index: 1, count: 5 }).refusal,
    ).toBeNull();
    expect(
      scopeWidgets(many, undefined, "g", 11, { index: 1, count: 5 }).refusal,
    ).toContain("Refusing to report a clean run over a set this small");
  });

  it("refuses an empty shard", () => {
    expect(
      scopeWidgets(many, undefined, "g", 0, { index: 11, count: 11 }).refusal,
    ).toContain("holds no render config");
  });
});
