import { describe, expect, it } from "vitest";
import { placeThresholdLabels } from "./thresholdLabels";

const plot = { x0: 50, y0: 10, x1: 350, y1: 170 };
const place = (
  over: Partial<Parameters<typeof placeThresholdLabels>[0]> = {},
) =>
  placeThresholdLabels({
    labels: [{ id: "a", width: 80, lineY: 90 }],
    plot,
    obstacles: [],
    traces: [],
    ...over,
  });

describe("placeThresholdLabels", () => {
  it("stands a label on the right end of its line when nothing is in the way", () => {
    expect(place().get("a")).toEqual({ x: 346, y: 85, anchor: "end" });
  });

  it("never lets two labels share room: the second on one line hangs under it", () => {
    const placed = place({
      labels: [
        { id: "limit", width: 80, lineY: 90 },
        { id: "now", width: 70, lineY: 90 },
      ],
    });
    expect(placed.get("limit")).toEqual({ x: 346, y: 85, anchor: "end" });
    expect(placed.get("now")).toEqual({ x: 346, y: 102, anchor: "end" });
  });

  it("keeps two labels on lines a few pixels apart from overlapping", () => {
    const placed = place({
      labels: [
        { id: "a", width: 80, lineY: 90 },
        { id: "b", width: 80, lineY: 96 },
      ],
    });
    const a = placed.get("a");
    const b = placed.get("b");
    expect(a && b && Math.abs(a.y - b.y) >= 11).toBe(true);
  });

  it("yields to a trace running through its spot, by hanging under the line", () => {
    const trace = { cx: [50, 350], cy: [82, 82] };
    expect(place({ traces: [trace] }).get("a")).toEqual({
      x: 346,
      y: 102,
      anchor: "end",
    });
  });

  it("yields to a mark standing on its spot, and to a trace less than to a mark", () => {
    const mark = { x0: 300, y0: 70, x1: 314, y1: 84 };
    const under = { cx: [50, 350], cy: [98, 98] };
    // Above is on the mark and below is on the trace: the trace is the lesser cover, so below wins over above, and the clear left end wins over both.
    expect(place({ obstacles: [mark], traces: [under] }).get("a")).toEqual({
      x: 54,
      y: 85,
      anchor: "start",
    });
    // Where a trace runs through every spot, the first one clear of the mark is taken.
    const everywhere = { cx: [50, 350, 50, 350], cy: [82, 82, 98, 98] };
    expect(place({ obstacles: [mark], traces: [everywhere] }).get("a")).toEqual(
      { x: 346, y: 102, anchor: "end" },
    );
  });

  it("hangs a label under a line at the top of the plot, where above would leave it", () => {
    expect(
      place({ labels: [{ id: "a", width: 80, lineY: 12 }] }).get("a"),
    ).toEqual({ x: 346, y: 24, anchor: "end" });
  });

  it("leaves out a label wider than the plot", () => {
    expect(
      place({ labels: [{ id: "a", width: 400, lineY: 90 }] }).get("a"),
    ).toBeNull();
  });
});
