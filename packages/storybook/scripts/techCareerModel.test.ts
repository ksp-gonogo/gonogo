import { describe, expect, it } from "vitest";
import {
  type CareerNode,
  nodesAt,
  playCareer,
  SCIENCE_RETURNS,
} from "./techCareerModel";

const node = (
  id: string,
  scienceCost: number,
  parents: string[],
): CareerNode => ({
  id,
  title: id,
  scienceCost,
  unlocked: false,
  parents,
});

const TREE = [
  node("start", 0, []),
  node("a", 5, ["start"]),
  node("b", 30, ["a"]),
  node("c", 12, ["start"]),
  node("d", 500, ["b", "c"]),
];

describe("playCareer", () => {
  const frames = playCareer(TREE);

  it("begins with only the root owned and nothing in hand", () => {
    expect(frames[0]).toMatchObject({ science: 0, ownedIds: ["start"] });
  });

  it("gives every flight an arrival frame before any purchase it pays for", () => {
    expect(frames[1]).toMatchObject({
      earned: SCIENCE_RETURNS[0],
      bought: null,
    });
    expect(frames[2].bought?.id).toBe("a");
    expect(frames[2].science).toBe(frames[1].science - 5);
  });

  it("buys the cheapest reachable node and never one with an unowned parent", () => {
    expect(frames.find((f) => f.bought)?.bought?.id).toBe("a");
    for (const f of frames) {
      const owned = new Set(f.ownedIds);
      for (const n of TREE.filter((t) => owned.has(t.id))) {
        expect(n.parents.every((p) => owned.has(p))).toBe(true);
      }
    }
  });

  it("never lets the balance go negative", () => {
    expect(frames.every((f) => f.science >= 0)).toBe(true);
  });

  it("only ever adds to what is owned", () => {
    frames.slice(1).forEach((f, i) => {
      expect(f.ownedIds).toEqual(expect.arrayContaining(frames[i].ownedIds));
    });
  });

  it("marks exactly the owned nodes as unlocked on the wire", () => {
    const last = frames[frames.length - 1];
    expect(
      nodesAt(TREE, last)
        .filter((n) => n.unlocked)
        .map((n) => n.id)
        .sort(),
    ).toEqual([...last.ownedIds].sort());
  });
});
