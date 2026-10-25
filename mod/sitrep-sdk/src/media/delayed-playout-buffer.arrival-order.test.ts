import { describe, expect, it } from "vitest";
import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
} from "./delayed-playout-buffer";

function clockAt(edge: number): DelayClockLike & { edge: number } {
  const clock = {
    edge,
    confirmedEdgeUt: () => clock.edge,
    onFrame: () => () => {},
  };
  return clock;
}

function released(
  keepArrivalOrder: boolean,
  stamps: number[],
): { id: number; ut: number }[] {
  const out: { id: number; ut: number }[] = [];
  const view = clockAt(Number.NEGATIVE_INFINITY);
  const buffer = new DelayedPlayoutBuffer<number>({
    view,
    maxBufferedBytes: 1000,
    keepArrivalOrder,
    onRelease: (f) => out.push({ id: f.data as number, ut: f.ut }),
  });
  stamps.forEach((ut, id) => {
    buffer.push({ ut, keyframe: false, data: id });
  });
  view.edge = Number.POSITIVE_INFINITY;
  buffer.pump();
  return out;
}

// A stamp that ran ahead by a second's drift, then snapped back
const DRIFTED = [10, 10.04, 10.08, 10.12, 10.03, 10.07, 10.11];

describe("DelayedPlayoutBuffer arrival order", () => {
  it("sorts by stamp by default, so a snapped-back stamp plays ahead of frames decoded earlier", () => {
    expect(released(false, DRIFTED).map((f) => f.id)).not.toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("plays frames in the order they decoded when asked to keep arrival order", () => {
    const out = released(true, DRIFTED);

    expect(out.map((f) => f.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < out.length; i += 1) {
      expect((out[i] as { ut: number }).ut).toBeGreaterThanOrEqual(
        (out[i - 1] as { ut: number }).ut,
      );
    }
  });

  it("starts the ordering afresh after a flush", () => {
    const out: number[] = [];
    const buffer = new DelayedPlayoutBuffer<number>({
      view: clockAt(Number.POSITIVE_INFINITY),
      maxBufferedBytes: 1000,
      keepArrivalOrder: true,
      onRelease: (f) => out.push(f.ut),
    });
    buffer.push({ ut: 5000, keyframe: false, data: 0 });
    buffer.flush();
    buffer.push({ ut: 1200, keyframe: false, data: 1 });

    expect(out).toEqual([5000, 1200]);
  });
});
