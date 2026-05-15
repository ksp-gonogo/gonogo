import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
  type VesselTopology,
} from "@gonogo/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTopology } from "./useTopology";

function topology(seq: number, partCount = 1): VesselTopology {
  return {
    topologySeq: seq,
    rootFlightId: 1,
    parts: Array.from({ length: partCount }, (_, i) => ({
      flightId: i + 1,
      persistentId: 1000 + i,
      parentFlightId: i === 0 ? null : 1,
      name: `part-${i}`,
      title: `Part ${i}`,
      manufacturer: "",
      category: "Pods",
      inverseStage: 0,
      crewCapacity: 0,
      maxTemp: 1200,
      crashTolerance: 8,
      dryMass: 0.1,
      orgPos: [0, 0, 0],
      bounds: { size: { x: 1, y: 1, z: 1 } },
      modules: [],
    })),
  };
}

let source: MockDataSource;

beforeEach(() => {
  source = new MockDataSource({ id: "data", keys: [] });
  registerDataSource(source);
  void source.connect();
});

afterEach(() => {
  cleanup();
  source.disconnect();
  clearRegistry();
});

describe("useTopology", () => {
  it("returns undefined until the first seq + topology arrive", () => {
    const { result } = renderHook(() => useTopology("data"));
    expect(result.current).toBeUndefined();
  });

  it("fetches topology when seq first appears", () => {
    const { result } = renderHook(() => useTopology("data"));

    act(() => {
      source.emit("v.topologySeq", 1);
    });
    expect(result.current).toBeUndefined();

    act(() => {
      source.emit("v.topology", topology(1, 3));
    });
    expect(result.current?.topologySeq).toBe(1);
    expect(result.current?.parts).toHaveLength(3);
  });

  it("retains the last topology between seq bumps and refetches on change", () => {
    const { result } = renderHook(() => useTopology("data"));

    // Separate acts: seq emit triggers the effect which subscribes to
    // v.topology; only then can a topology emit reach the subscriber.
    act(() => {
      source.emit("v.topologySeq", 1);
    });
    act(() => {
      source.emit("v.topology", topology(1, 3));
    });
    expect(result.current?.topologySeq).toBe(1);

    // Same seq tick repeatedly — no refetch, value preserved.
    act(() => {
      source.emit("v.topologySeq", 1);
    });
    expect(result.current?.topologySeq).toBe(1);
    expect(result.current?.parts).toHaveLength(3);

    // Seq bumps — refetch path opens, new payload arrives.
    act(() => {
      source.emit("v.topologySeq", 5);
    });
    act(() => {
      source.emit("v.topology", topology(5, 8));
    });
    expect(result.current?.topologySeq).toBe(5);
    expect(result.current?.parts).toHaveLength(8);
  });

  it("ignores paused-handler sentinels and other non-topology values", () => {
    const { result } = renderHook(() => useTopology("data"));

    act(() => {
      source.emit("v.topologySeq", 1);
    });
    act(() => {
      source.emit("v.topology", 1); // Telemachus partless-paused sentinel
    });
    expect(result.current).toBeUndefined();

    act(() => {
      source.emit("v.topology", topology(1, 2));
    });
    expect(result.current?.parts).toHaveLength(2);
  });

  it("recovers when seq bumps repeatedly without an interleaved topology push", () => {
    // Destruction cascade: 30+ onPartDie callbacks bump seq within a
    // short window and Telemachus is too busy to push v.topology in
    // between. The earlier 2s timeout would drop the subscription on
    // its own, and if seq then stabilised the hook never re-armed and
    // the widget froze at the pre-cascade snapshot. With no timer, the
    // last subscription stays alive until Telemachus catches up.
    const { result } = renderHook(() => useTopology("data"));

    act(() => {
      source.emit("v.topologySeq", 1);
    });
    act(() => {
      source.emit("v.topology", topology(1, 3));
    });
    expect(result.current?.topologySeq).toBe(1);

    // Rapid seq bumps with no v.topology pushes in between.
    act(() => {
      source.emit("v.topologySeq", 2);
    });
    act(() => {
      source.emit("v.topologySeq", 3);
    });
    act(() => {
      source.emit("v.topologySeq", 4);
    });
    act(() => {
      source.emit("v.topologySeq", 5);
    });
    // Topology is still the pre-cascade snapshot at this point.
    expect(result.current?.topologySeq).toBe(1);

    // Telemachus catches up and pushes the post-cascade topology. The
    // hook's last subscription is still live — without it, this push
    // would land on a dead subscription and the widget would stay
    // frozen.
    act(() => {
      source.emit("v.topology", topology(5, 8));
    });
    expect(result.current?.topologySeq).toBe(5);
    expect(result.current?.parts).toHaveLength(8);
  });

  it("unsubscribes from v.topology after the first valid push", () => {
    const { result } = renderHook(() => useTopology("data"));

    act(() => {
      source.emit("v.topologySeq", 1);
    });
    act(() => {
      source.emit("v.topology", topology(1, 1));
    });
    expect(result.current?.parts).toHaveLength(1);

    // After unsubscribing, further pushes to v.topology should not change
    // the snapshot — the hook only re-arms on a fresh seq bump.
    act(() => {
      source.emit("v.topology", topology(99, 99));
    });
    expect(result.current?.topologySeq).toBe(1);
    expect(result.current?.parts).toHaveLength(1);
  });
});
