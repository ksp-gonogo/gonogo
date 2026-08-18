import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, screen, waitFor } from "@ksp-gonogo/test-utils";
import { Component, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { usePartsLive } from "./usePartsLive";

/**
 * Characterisation of what `usePartsLive` DOES when its one telemetry read
 * (`useTelemetry("vessel.parts")`) carries no payload, ahead of that read
 * becoming a `Reading` union.
 *
 * The hook has no absence gate of its own. It delegates to three builders in
 * `vesselPartsAdapter.ts` that each open with `if (!wire) return out`, then
 * coerces every miss to a value: `?? null` for thermal, `?? {}` for
 * resources, nothing for partState. So the interesting question is not
 * whether it returns something, it always does, but WHAT it says about a part
 * nobody has told it anything about.
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
  currentTemp?: number;
  resources?: Record<string, unknown>;
  moduleStates?: unknown[];
}

/** A whole, well-formed wire part; overrides carve individual fields back out. */
function wirePart(flightId: number, overrides: WirePartOverrides = {}) {
  return {
    id: String(flightId),
    parentId: flightId === 1 ? undefined : "1",
    name: `part-${flightId}`,
    title: `Part ${flightId}`,
    position: { x: 0, y: 0, z: 0 },
    bounds: { size: { x: 1, y: 1, z: 1 } },
    dryMass: 0.1,
    inverseStage: 0,
    maxTemp: 1200,
    currentTemp: 300,
    category: "Pods",
    modules: [],
    resources: {
      LiquidFuel: { amount: 4, maxAmount: 10, flow: -0.5, nominalFlow: -0.5 },
    },
    moduleStates: [{ type: "engine", state: "Nominal", flameout: false }],
    isRobotics: false,
    isPowerRelated: false,
    ...overrides,
  };
}

/**
 * Catches a render-time throw from the hook under test so it can be asserted
 * on, instead of tearing the test run down as an unhandled error. Renders a
 * marker child so a test can prove the subtree survived (or did not).
 */
class CatchRenderError extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.failed) return null;
    return <div data-testid="parts-live-probe">{this.props.children}</div>;
  }
}

describe("usePartsLive: what undefined means today", () => {
  it("still reports an entry for every requested flightId when nothing has arrived", async () => {
    // The never-arrived case, and the highest-value pin in this file. All three
    // `if (!wire) return out` gates fire, every lookup misses, and the hook
    // answers with a FULLY POPULATED slice per id: thermal is a confirmed
    // `null`, resources a confirmed empty set. A consumer cannot tell this from
    // a real part that has no resources and has not been simulated.
    const fixture = buildStreamFixture();
    const { result } = renderHook(() => usePartsLive([12, 34]), {
      wrapper: fixture.Provider,
    });

    expect([...result.current.keys()]).toEqual([12, 34]);
    expect(result.current.get(12)).toEqual({
      thermal: null,
      resources: {},
      partState: undefined,
    });
    // `partState` is the one field with no `??` fallback, so it is the ONLY
    // channel by which "nothing has arrived" survives into the slice.
    expect(result.current.get(34)?.partState).toBeUndefined();
    // A real subscription happened, so the empty answer above is the hook's
    // reading of an unfed topic and not a missing read path.
    expect(fixture.transport.isSubscribed("vessel.parts")).toBe(true);
  });

  it("reports the same populated slice with no TelemetryProvider mounted at all", () => {
    // A missing provider is a wiring fault and it reads identically to a cold
    // topic: `{ thermal: null, resources: {} }` for a part the hook has never
    // heard a word about.
    const { result } = renderHook(() => usePartsLive([12]));

    expect(result.current.get(12)).toEqual({
      thermal: null,
      resources: {},
      partState: undefined,
    });
  });

  it("returns an empty map for an empty flightId list, the one case that reports nothing", () => {
    // The `idsKey.length === 0` short circuit. The map is empty because the
    // CALLER asked for nothing, not because no telemetry arrived: the two look
    // the same from the map's size alone.
    const fixture = buildStreamFixture();
    const { result } = renderHook(() => usePartsLive([]), {
      wrapper: fixture.Provider,
    });

    expect(result.current.size).toBe(0);
  });

  it("a confirmed tombstone (payload null) reverts to the same never-arrived slice", async () => {
    // null-vs-undefined: the builders' gate is `if (!wire)`, which is truthiness
    // and not an `undefined` check, so a confirmed "there is no vessel.parts"
    // is answered exactly as a cold topic is. The hook does NOT distinguish
    // them, and this pins that it forgets live values it already held.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => usePartsLive([1]), {
      wrapper: fixture.Provider,
    });

    act(() => fixture.transport.emit("vessel.parts", { parts: [wirePart(1)] }));
    await waitFor(() => expect(result.current.get(1)?.thermal).not.toBeNull());

    act(() => fixture.transport.emit("vessel.parts", null, { validAt: 5 }));

    await waitFor(() =>
      expect(result.current.get(1)).toEqual({
        thermal: null,
        resources: {},
        partState: undefined,
      }),
    );
    // Proves the assertion above is about the gates and not about a dropped
    // emission.
    expect(fixture.store.sample("vessel.parts")?.payload).toBeNull();
  });

  it("a flightId absent from an arrived payload gets the identical never-arrived slice", async () => {
    // The conflation the hook's own doc comment admits to ("a part not present
    // in the latest payload is simply absent from the map, same as when no
    // payload has arrived yet"), except it is not absent from the map: it is
    // present, with fabricated `null`/`{}` values, next to a sibling carrying
    // real ones.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => usePartsLive([1, 999]), {
      wrapper: fixture.Provider,
    });

    act(() => fixture.transport.emit("vessel.parts", { parts: [wirePart(1)] }));

    await waitFor(() =>
      expect(result.current.get(1)?.resources).toEqual({
        LiquidFuel: { amount: 4, maxAmount: 10, flow: -0.5, nominalFlow: -0.5 },
      }),
    );
    expect(result.current.get(999)).toEqual({
      thermal: null,
      resources: {},
      partState: undefined,
    });
  });

  it("a part with no currentTemp reports thermal: null, the same value a part nobody mentioned gets", async () => {
    // Field-level absence inside an arrived record. `derivePartThermal`'s
    // `p.currentTemp == null` catches absent AND explicit null identically, and
    // `?? null` in the hook then collapses "the map holds null for this part"
    // into "the map has no entry for this part". Three distinct facts, one
    // value.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => usePartsLive([1, 2]), {
      wrapper: fixture.Provider,
    });

    act(() =>
      fixture.transport.emit("vessel.parts", {
        parts: [wirePart(1, { currentTemp: undefined }), wirePart(2)],
      }),
    );

    await waitFor(() => expect(result.current.get(2)?.thermal).not.toBeNull());
    expect(result.current.get(1)?.thermal).toBeNull();
    // The rest of the same part's live data is intact, so `thermal: null` here
    // really is a per-field statement and not a whole-part one.
    expect(result.current.get(1)?.resources).not.toEqual({});
    expect(result.current.get(1)?.partState).toBeDefined();
  });

  it("a part with an empty moduleStates list gets a real partState, distinguishable from a part nobody mentioned", async () => {
    // The one distinction the hook preserves: `partStateByFlightId.get(fid)`
    // has no fallback, so `{ seq: 0, modules: [] }` (a part that arrived with
    // no modules) is tellable from `undefined` (no payload for this part).
    // This is the assertion a migration would most easily flatten.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const { result } = renderHook(() => usePartsLive([1, 999]), {
      wrapper: fixture.Provider,
    });

    act(() =>
      fixture.transport.emit("vessel.parts", {
        parts: [wirePart(1, { moduleStates: [] })],
      }),
    );

    await waitFor(() =>
      expect(result.current.get(1)?.partState).toEqual({ seq: 0, modules: [] }),
    );
    expect(result.current.get(999)?.partState).toBeUndefined();
  });
});

describe("usePartsLive: a partial per-part payload", () => {
  it("THROWS out of render when an arrived part omits `resources` entirely", async () => {
    // Not a soft answer: `derivePartResources` does
    // `Object.entries(p.resources)` with no guard, so a record that arrived
    // missing one per-part field takes the render down instead of reporting
    // that field as absent. Pinned because it is the one absence in this hook
    // that is NOT coerced to a fallback, and because it is the shape a
    // migration is most likely to convert into a silently rendered zero.
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    const caught: unknown[] = [];

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <fixture.Provider>
          <CatchRenderError onError={(error) => caught.push(error)}>
            {children}
          </CatchRenderError>
        </fixture.Provider>
      );
    }

    renderHook(() => usePartsLive([1]), { wrapper: Wrapper });

    const part = wirePart(1) as Record<string, unknown>;
    delete part.resources;
    act(() => fixture.transport.emit("vessel.parts", { parts: [part] }));

    await waitFor(() => expect(caught).toHaveLength(1));
    expect(String(caught[0])).toContain(
      "Cannot convert undefined or null to object",
    );
    // The whole subtree is gone, not just the one part's resources: nothing
    // downstream of the hook renders after this.
    expect(screen.queryByTestId("parts-live-probe")).toBeNull();
  });
});
