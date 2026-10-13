import { TINY_SIZE } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { WidgetRecord } from "./render/widgetRecord";
import { widgetFactsOf, widgetFactValueMd } from "./widget-facts";

const record = (over: Partial<WidgetRecord> = {}): WidgetRecord => ({
  id: "w",
  name: "W",
  description: "d",
  tags: [],
  channels: [],
  optionalChannels: [],
  commands: [],
  channelFamilies: [],
  optionalChannelFamilies: [],
  readsFromConfig: false,
  dataRequirements: [],
  fields: [],
  actions: [],
  augmentSlots: [],
  contributionSlots: [],
  requires: [],
  replaces: null,
  pushable: false,
  defaultSize: null,
  minSize: null,
  tiny: false,
  ...over,
});

const rowOf = (r: WidgetRecord, id: string, omit?: (s: string) => boolean) => {
  const fact = widgetFactsOf(r, { omitSlot: omit }).find((f) => f.id === id);
  return fact && { label: fact.label, value: widgetFactValueMd(fact.items) };
};

describe("widgetFactsOf", () => {
  it("states only the id for an empty registration", () => {
    expect(widgetFactsOf(record()).map((f) => f.id)).toEqual(["id"]);
  });

  it("reads flat keys under their own label when no channels are declared", () => {
    expect(rowOf(record({ dataRequirements: ["a.b"] }), "reads")).toEqual({
      label: "Reads, as flat keys (Topic ids or Topic field paths)",
      value: "`a.b`",
    });
  });

  it("keeps a family pattern's angle brackets inside its code span", () => {
    expect(
      rowOf(record({ channelFamilies: ["fleet.<vessel>.contact"] }), "reads")
        ?.value,
    ).toBe("`fleet.<vessel>.contact`");
  });

  it("states the commands, the settings-chosen Topics and both sizes", () => {
    const r = record({
      commands: ["x.go"],
      readsFromConfig: true,
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 2, h: 2 },
      requires: ["flight"],
    });
    expect(rowOf(r, "sends")?.value).toBe("`x.go`");
    expect(rowOf(r, "readsFromSettings")?.value).toContain("settings");
    expect(rowOf(r, "defaultSize")?.value).toBe("4 × 3");
    expect(rowOf(r, "minSize")?.value).toBe("2 × 2");
    expect(rowOf(r, "needs")?.value).toBe("a vessel in flight");
  });

  it("uses the sdk's tiny size", () => {
    const row = rowOf(
      record({ tiny: true, minSize: { w: 9, h: 9 } }),
      "minSize",
    );
    expect(row?.value).toContain(`${TINY_SIZE.w} × ${TINY_SIZE.h}`);
  });

  it("gives a widget with a tiny form both its tiny size and its full-widget size", () => {
    expect(
      rowOf(record({ tiny: true, minSize: { w: 3, h: 4 } }), "minSize")?.value,
    ).toBe("3 × 3, drawing only its tiny form; 3 × 4 for the full widget");
  });

  it("writes an action as its label then its id, escaping a pipe", () => {
    expect(
      rowOf(record({ actions: [{ id: "t", label: "A | B" }] }), "actions")
        ?.value,
    ).toBe("A \\| B (`t`)");
  });

  it("leaves out the slots a page lists elsewhere", () => {
    const r = record({ augmentSlots: ["w.a", "w.badges"] });
    expect(rowOf(r, "slots", (s) => s.endsWith(".badges"))?.value).toBe(
      "`w.a`",
    );
    expect(
      rowOf(record({ augmentSlots: ["w.badges"] }), "slots", (s) =>
        s.endsWith(".badges"),
      ),
    ).toBeUndefined();
  });
});
