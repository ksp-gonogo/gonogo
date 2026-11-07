import { describe, expect, it } from "vitest";
import { faceDebtKey, seedFaceDebt, settleFaceDebt } from "./faceShiftDebt";
import { sliceShardByWidget } from "./gateScope";
import type { WidgetRenderConfig } from "./widgetRenderHarness";

const MOVED =
  'navball @ landscape-12x12 (rest): button "SAS" face "sent": div "Mode" moved 0.0, 14.0px';

describe("faceDebtKey", () => {
  it("keys a finding by widget and control, whatever the scene or face", () => {
    expect(faceDebtKey(MOVED)).toBe('navball|button "SAS"');
    expect(faceDebtKey(MOVED.replace('"sent"', '"refused"'))).toBe(
      'navball|button "SAS"',
    );
  });

  it("returns undefined for a line that is not a face finding", () => {
    expect(faceDebtKey("something else")).toBeUndefined();
  });
});

describe("settleFaceDebt", () => {
  const debt = { 'navball|button "SAS"': "sent: Mode moved" };

  it("covers a finding the debt names and reports the rest", () => {
    const other = MOVED.replace("navball", "twr");
    const out = settleFaceDebt(
      [MOVED, other],
      new Set(["navball", "twr"]),
      debt,
    );
    expect(out.covered).toBe(1);
    expect(out.reported).toEqual([other]);
    expect(out.stale).toEqual([]);
  });

  it("names an entry whose widget was checked and reported nothing", () => {
    const out = settleFaceDebt([], new Set(["navball"]), debt);
    expect(out.stale).toEqual(['navball|button "SAS"']);
  });

  it("leaves an entry alone when its widget was not part of the run", () => {
    expect(settleFaceDebt([], new Set(["twr"]), debt).stale).toEqual([]);
  });
});

describe("seedFaceDebt", () => {
  it("writes one entry per control, preferring a reason that names its element", () => {
    const bare = MOVED.replace('div "Mode"', "div");
    const lines = seedFaceDebt([bare, MOVED]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"navball|button \\"SAS\\""');
    expect(lines[0]).toContain('div \\"Mode\\" moved');
  });
});

describe("sharded runs", () => {
  const config = (widgetId: string, label: string) =>
    ({ widgetId, label }) as WidgetRenderConfig;
  // "science" has two configs and its debt matches only in the second.
  const configs = [
    config("science", "a"),
    config("science", "c"),
    config("navball", "b"),
    config("twr", "d"),
  ];
  const debt = { 'science|button "Archive"': "press 1: div resized" };
  const findingOf = (c: WidgetRenderConfig) =>
    c.label === "c"
      ? [
          'science @ m (s): button "Archive" face "press 1": div "Body" resized 0.0, -5.0px',
        ]
      : [];

  it("keeps every config of a widget in one shard and deals each config once", () => {
    const first = sliceShardByWidget(configs, { index: 1, count: 2 });
    const second = sliceShardByWidget(configs, { index: 2, count: 2 });
    expect([...first, ...second].map((c) => c.label).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    for (const id of ["science", "navball", "twr"]) {
      const inFirst = first.some((c) => c.widgetId === id);
      const inSecond = second.some((c) => c.widgetId === id);
      expect(inFirst !== inSecond).toBe(true);
    }
  });

  it("reports no stale debt in either shard when the match is in another config of the same widget", () => {
    for (const index of [1, 2]) {
      const shard = sliceShardByWidget(configs, { index, count: 2 });
      const out = settleFaceDebt(
        shard.flatMap(findingOf),
        new Set(shard.map((c) => c.widgetId)),
        debt,
      );
      expect(out.stale).toEqual([]);
      expect(out.reported).toEqual([]);
    }
  });
});
