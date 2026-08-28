import type { Contributed, PlotEntry, PlotFrame } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergePlots } from "./mergePlots";

/**
 * What a set of contributions MEANS, which is the whole of the subject design
 * and is testable without a DOM.
 *
 * The cases that matter are the ones where two authors disagree, because those
 * are the ones a picture would show as "fine" while being wrong: a duplicate
 * corridor drawn twice, an enrichment stranded with nothing to enrich, two
 * authors both claiming to own one plot's axes.
 */

const FRAME: PlotFrame = {
  xDomain: [0, 100],
  xUnit: "m/s",
  yDomain: [0, 1000],
  yUnit: "m",
};

function entry(
  contributionId: string,
  over: Partial<PlotEntry> & Pick<PlotEntry, "subject">,
): Contributed<PlotEntry> {
  return {
    layers: [{ kind: "rule", id: "r", along: "y", value: 1 }],
    ...over,
    contributionId,
  } as Contributed<PlotEntry>;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // No host is installed in a unit test, so the conflict report takes its
  // `console` fallback. Spied rather than silenced: the point of the rule is
  // that the collision is LOUD, and a test that muted it would be asserting
  // the opposite of the design.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("mergePlots", () => {
  it("draws ONE plot when two contributions name one subject", () => {
    const merged = mergePlots([
      entry("core:descent-envelope", {
        subject: "descent-envelope",
        title: "Descent envelope",
        frame: FRAME,
        layers: [{ kind: "rule", id: "terminal", along: "y", value: 10 }],
      }),
      entry("aero:descent-envelope", {
        subject: "descent-envelope",
        layers: [{ kind: "rule", id: "model", along: "y", value: 20 }],
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Descent envelope");
    expect(merged[0].layers.map((l) => l.id)).toEqual(["terminal", "model"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("draws NOTHING for an enrichment whose subject nobody framed", () => {
    // FAR with no landing envelope on the board: its model curve exists to part
    // from the drag back-out, and with nothing to part from it has nothing to
    // say. A rival corridor beside the real one would be worse than silence.
    const merged = mergePlots([
      entry("aero:descent-envelope", { subject: "descent-envelope" }),
    ]);
    expect(merged).toEqual([]);
  });

  it("keeps a lone framed plot untouched, which is the no-atmosphere case", () => {
    // The constraint the whole design has to hold: a descent with no aero model
    // is a first-class plot drawn by the host alone, not a degraded merge.
    const merged = mergePlots([
      entry("core:touchdown-site", {
        subject: "touchdown-site",
        title: "Touchdown site",
        frame: FRAME,
        aspect: 1,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].frame).toEqual(FRAME);
    expect(merged[0].aspect).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps subjects apart, and preserves the order they arrived in", () => {
    const merged = mergePlots([
      entry("core:a", { subject: "descent-envelope", frame: FRAME }),
      entry("core:b", { subject: "touchdown-site", frame: FRAME }),
    ]);
    expect(merged.map((m) => m.subject)).toEqual([
      "descent-envelope",
      "touchdown-site",
    ]);
  });

  /**
   * The case the rule exists for. Two authors both claim a subject's axes; the
   * data cannot say whether they mean the same plot or collided on a word, so
   * the arranger does not guess. First frame wins deterministically, the
   * loser's marks still land, and somebody is told.
   */
  it("takes the FIRST frame when two are supplied, and says so out loud", () => {
    // Same units as FRAME, so this is a redundant frame rather than a
    // different measure: the loser's marks stay. The DIFFERENT-measure case is
    // its own test below.
    const other: PlotFrame = {
      xDomain: [0, 5],
      xUnit: "m/s",
      yDomain: [0, 5],
      yUnit: "m",
    };
    const merged = mergePlots([
      entry("core:first", {
        subject: "descent-envelope",
        title: "Mine",
        frame: FRAME,
        layers: [{ kind: "rule", id: "mine", along: "y", value: 1 }],
      }),
      entry("guest:second", {
        subject: "descent-envelope",
        title: "Theirs",
        frame: other,
        layers: [{ kind: "rule", id: "theirs", along: "y", value: 2 }],
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].frame).toEqual(FRAME);
    expect(merged[0].title).toBe("Mine");
    // Not dropped: it plainly has something to say about this subject.
    expect(merged[0].layers.map((l) => l.id)).toEqual(["mine", "theirs"]);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    // Both owners named, so the collision can be chased to its authors rather
    // than guessed at from a screenshot.
    expect(message).toContain("core:first");
    expect(message).toContain("guest:second");
    expect(message).toContain("descent-envelope");
  });

  /**
   * The answer to "what if a contribution wants to overwrite a value in the
   * frame". Domains merge and cannot lose data; units and scales are
   * categorical and stay the frame-owner's.
   */
  it("widens the frame to contain a guest's marks, so nothing is clipped", () => {
    const merged = mergePlots([
      entry("core:host", {
        subject: "descent-envelope",
        frame: { xDomain: [0, 400], yDomain: [0, 1000], xUnit: "m/s" },
        layers: [{ kind: "marker", id: "mine", at: { x: 100, y: 100 } }],
      }),
      entry("guest:faster", {
        subject: "descent-envelope",
        // The craft reaches 800 m/s and 2 km, past the host's window.
        layers: [{ kind: "marker", id: "theirs", at: { x: 800, y: 2000 } }],
      }),
    ]);
    expect(merged[0].frame.xDomain).toEqual([0, 800]);
    expect(merged[0].frame.yDomain).toEqual([0, 2000]);
    // Categorical: untouched, and only ever the owner's.
    expect(merged[0].frame.xUnit).toBe("m/s");
  });

  it("only ever widens, so a guest cannot hide the host's own marks", () => {
    const merged = mergePlots([
      entry("core:host", {
        subject: "s",
        frame: { xDomain: [0, 400], yDomain: [0, 1000] },
        layers: [{ kind: "marker", id: "mine", at: { x: 390, y: 990 } }],
      }),
      entry("guest:tiny", {
        subject: "s",
        layers: [{ kind: "marker", id: "theirs", at: { x: 1, y: 1 } }],
      }),
    ]);
    expect(merged[0].frame.xDomain).toEqual([0, 400]);
    expect(merged[0].frame.yDomain).toEqual([0, 1000]);
  });

  it("does not let CONTEXT set the scale the readings are drawn at", () => {
    // A relief spans a footprint and a field is a wash; neither is a reading,
    // so neither pulls the domain. `plotLayerExtent` is where that is decided
    // and this is the case that would notice if it stopped being true.
    const merged = mergePlots([
      entry("core:host", {
        subject: "s",
        frame: { xDomain: [0, 10], yDomain: [0, 10] },
        layers: [
          { kind: "marker", id: "m", at: { x: 5, y: 5 } },
          {
            kind: "relief",
            id: "terrain",
            values: [1, 2, 3, 4],
            size: 2,
            bounds: { x0: -9999, y0: -9999, x1: 9999, y1: 9999 },
          },
        ],
      }),
    ]);
    expect(merged[0].frame.xDomain).toEqual([0, 10]);
  });

  it("returns the frame unchanged, referentially, when nothing needed widening", () => {
    const frame: PlotFrame = { xDomain: [0, 400], yDomain: [0, 1000] };
    const merged = mergePlots([
      entry("core:host", {
        subject: "s",
        frame,
        layers: [{ kind: "marker", id: "m", at: { x: 1, y: 1 } }],
      }),
    ]);
    expect(merged[0].frame).toBe(frame);
  });

  it("DROPS the loser's layers when the two frames measure different things", () => {
    // Metres and feet have no combination. Drawing a foot-stated curve against
    // a metre axis does not clip it, it moves it: the marks would be somewhere
    // the data never said. So they go, and somebody is told why.
    const merged = mergePlots([
      entry("core:metres", {
        subject: "s",
        frame: { xDomain: [0, 10], yDomain: [0, 10], yUnit: "m" },
        layers: [{ kind: "rule", id: "mine", along: "y", value: 1 }],
      }),
      entry("guest:feet", {
        subject: "s",
        frame: { xDomain: [0, 10], yDomain: [0, 30], yUnit: "ft" },
        layers: [{ kind: "rule", id: "theirs", along: "y", value: 3 }],
      }),
    ]);

    expect(merged[0].layers.map((l) => l.id)).toEqual(["mine"]);
    expect(merged[0].frame.yUnit).toBe("m");
    expect(String(warn.mock.calls[0][0])).toContain("DROPPED");
  });

  it("keeps the loser's layers when the two frames measure the SAME thing", () => {
    // A redundant frame is not a wrong one. Same units, same scale: the second
    // author is drawing the same plot and its marks belong on these axes.
    const merged = mergePlots([
      entry("core:a", {
        subject: "s",
        frame: { xDomain: [0, 10], yDomain: [0, 10], yUnit: "m" },
        layers: [{ kind: "rule", id: "mine", along: "y", value: 1 }],
      }),
      entry("guest:b", {
        subject: "s",
        frame: { xDomain: [0, 99], yDomain: [0, 99], yUnit: "m" },
        layers: [{ kind: "rule", id: "theirs", along: "y", value: 2 }],
      }),
    ]);
    expect(merged[0].layers.map((l) => l.id)).toEqual(["mine", "theirs"]);
    expect(String(warn.mock.calls[0][0])).not.toContain("DROPPED");
  });

  it("never widens a SPATIAL frame, because its two axes are one scale", () => {
    // A map's window is the map's window. Stretching one axis to reach a mark
    // makes a circle an ellipse and a nine-degree slope draw at some other
    // angle; a mark outside a map is off the map, which is a thing maps do.
    const map: PlotFrame = {
      kind: "spatial",
      xDomain: [-100, 100],
      yDomain: [-100, 100],
      xUnit: "m",
      yUnit: "m",
    };
    const merged = mergePlots([
      entry("core:site", {
        subject: "touchdown-site",
        frame: map,
        layers: [{ kind: "marker", id: "far", at: { x: 9000, y: 9000 } }],
      }),
    ]);
    expect(merged[0].frame).toBe(map);
  });

  it("treats a map and a chart of one subject as an author error", () => {
    const merged = mergePlots([
      entry("core:map", {
        subject: "s",
        frame: { kind: "spatial", xDomain: [0, 10], yDomain: [0, 10] },
        layers: [{ kind: "marker", id: "mine", at: { x: 1, y: 1 } }],
      }),
      entry("guest:chart", {
        subject: "s",
        frame: { kind: "cartesian", xDomain: [0, 10], yDomain: [0, 10] },
        layers: [{ kind: "marker", id: "theirs", at: { x: 2, y: 2 } }],
      }),
    ]);
    // Marks meant for a chart, placed on a map, are placed wrongly: they go.
    expect(merged[0].layers.map((l) => l.id)).toEqual(["mine"]);
    expect(merged[0].frame.kind).toBe("spatial");
    expect(String(warn.mock.calls[0][0])).toContain("DROPPED");
  });

  it("does NOT union two frames into a third nobody asked for", () => {
    const merged = mergePlots([
      entry("core:first", {
        subject: "s",
        frame: { xDomain: [0, 10], yDomain: [0, 10] },
      }),
      entry("guest:second", {
        subject: "s",
        frame: { xDomain: [0, 9999], yDomain: [0, 9999] },
      }),
    ]);
    expect(merged[0].frame.xDomain).toEqual([0, 10]);
    expect(merged[0].frame.yDomain).toEqual([0, 10]);
  });

  it("drops a framed plot that nobody put a mark on", () => {
    const merged = mergePlots([
      entry("core:empty", { subject: "s", frame: FRAME, layers: [] }),
    ]);
    expect(merged).toEqual([]);
  });

  it("draws a framed plot carried entirely by someone else's marks", () => {
    // A host stating axes it has nothing to draw on is still a plot, once a
    // guest fills it. The frame is a policy, not a claim to have marks.
    const merged = mergePlots([
      entry("core:frame-only", { subject: "s", frame: FRAME, layers: [] }),
      entry("guest:marks", {
        subject: "s",
        layers: [{ kind: "rule", id: "theirs", along: "y", value: 3 }],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].layers.map((l) => l.id)).toEqual(["theirs"]);
  });

  it("keys the plot by the framing contribution, not by the subject", () => {
    // A subject is an author's free string; a contribution id is namespaced by
    // its owner, so it is the half that cannot collide across two boards.
    const merged = mergePlots([
      entry("core:descent-envelope", {
        subject: "descent-envelope",
        frame: FRAME,
      }),
    ]);
    expect(merged[0].key).toBe("core:descent-envelope");
  });
});
