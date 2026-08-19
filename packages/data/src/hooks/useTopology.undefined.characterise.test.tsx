import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useTopology } from "./useTopology";

/**
 * Characterisation of what `useTopology` DOES when its one telemetry read
 * (`useTelemetry("vessel.parts")`) carries no payload, ahead of that read
 * becoming a `Reading` union.
 *
 * The whole hook is one absence gate: `wire ? derive(wire) : undefined`
 * (useTopology.ts:22). Every distinct upstream condition below funnels
 * through it and comes out the same `undefined`, so these tests exist to
 * record WHICH conditions are currently conflated, and by what.
 */

/** Same pinned-clock fixture pattern as the sibling `useTopology.test.tsx`. */
function buildStreamFixture(opts: { pinnedUt?: number } = {}) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

interface WirePartOverrides {
  parentId?: string;
  up?: { x: number; y: number; z: number };
  maxTemp?: number;
}

function wirePart(index: number, overrides: WirePartOverrides = {}) {
  return {
    id: String(index + 1),
    parentId: index === 0 ? undefined : "1",
    name: `part-${index}`,
    title: `Part ${index}`,
    position: { x: 0, y: -index, z: 0 },
    bounds: { size: { x: 1, y: 1, z: 1 } },
    dryMass: 0.1,
    inverseStage: 0,
    maxTemp: 1200,
    category: "Pods",
    modules: [],
    isRobotics: false,
    isPowerRelated: false,
    ...overrides,
  };
}

function vesselPartsWire(partCount: number) {
  return { parts: Array.from({ length: partCount }, (_, i) => wirePart(i)) };
}

describe("useTopology: what undefined means today", () => {
  it("returns exactly undefined, not an empty topology, when nothing has arrived", () => {
    // The never-arrived case. Pins that the gate answers `undefined` rather
    // than a zero-part `VesselTopology`, so a consumer distinguishes
    // "no data" from "a vessel with no parts" purely by truthiness.
    const fixture = buildStreamFixture();
    const { result } = renderHook(() => useTopology(), {
      wrapper: fixture.Provider,
    });

    expect(result.current).toBeUndefined();
  });

  it("returns undefined with no TelemetryProvider mounted, identical to nothing having arrived", () => {
    // A missing provider is a WIRING fault, and it reads exactly like a cold
    // topic. Nothing in the return value can tell them apart.
    const { result } = renderHook(() => useTopology());

    expect(result.current).toBeUndefined();
  });

  it("a confirmed tombstone (payload null) forgets the topology it already had, and reports it as undefined", async () => {
    // null-vs-undefined: the store DOES distinguish them (`payload: null` is
    // a confirmed "there is no value", `undefined` is "never received"), and
    // `wire ? ... : undefined` throws that distinction away. This pins the
    // conflating behaviour: an observed topology reverts to the same
    // `undefined` a cold topic gives.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => useTopology(), {
      wrapper: fixture.Provider,
    });

    act(() => fixture.transport.emit("vessel.parts", vesselPartsWire(3)));
    await waitFor(() => expect(result.current?.parts).toHaveLength(3));

    act(() => fixture.transport.emit("vessel.parts", null, { validAt: 5 }));

    await waitFor(() => expect(result.current).toBeUndefined());
    // Proves the assertion above is about the gate and not about a dropped
    // emission: the store is holding a real tombstone, and the hook turned it
    // into the same `undefined` a cold topic gives.
    expect(fixture.store.sample("vessel.parts")?.payload).toBeNull();
  });

  it("an EMPTY parts payload is truthy, so a consumer's !topology gate does not fire for it", async () => {
    // The other side of the gate, and the reason the gate is load-bearing: a
    // record that arrived carrying zero parts produces a real object with a
    // FABRICATED rootFlightId of 0 (`root ? Number(root.id) : 0`), not
    // undefined. So "no parts" and "no data" are told apart by truthiness
    // only, which is exactly the discrimination a always-truthy `Reading`
    // would remove.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => useTopology(), {
      wrapper: fixture.Provider,
    });

    act(() => fixture.transport.emit("vessel.parts", { parts: [] }));

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current).toEqual({
      topologySeq: 0,
      rootFlightId: 0,
      parts: [],
    });
  });

  it("invents rootFlightId 0 when no part has an absent parentId, rather than reporting no root", async () => {
    // A partial payload: every part claims a parent, so the
    // `p.parentId == null` root search finds nothing. The hook does not
    // surface that; it emits 0, a flightId no part has, silently.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => useTopology(), {
      wrapper: fixture.Provider,
    });

    act(() =>
      fixture.transport.emit("vessel.parts", {
        parts: [wirePart(0, { parentId: "99" }), wirePart(1)],
      }),
    );

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.rootFlightId).toBe(0);
    expect(result.current?.parts.map((p) => p.flightId)).toEqual([1, 2]);
  });

  it("a part with no `up` derives up: undefined while every other field derives normally", async () => {
    // A field-level absence INSIDE an arrived record, distinct from the record
    // being absent: `p.up ? ... : undefined` fails soft, so the part is still
    // in the topology, just without an orientation.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => useTopology(), {
      wrapper: fixture.Provider,
    });

    act(() =>
      fixture.transport.emit("vessel.parts", {
        parts: [wirePart(0), wirePart(1, { up: { x: 0, y: 1, z: 0 } })],
      }),
    );

    await waitFor(() => expect(result.current?.parts).toHaveLength(2));
    expect(result.current?.parts[0]?.up).toBeUndefined();
    expect(result.current?.parts[0]?.name).toBe("part-0");
    expect(result.current?.parts[1]?.up).toEqual([0, 1, 0]);
  });
});
