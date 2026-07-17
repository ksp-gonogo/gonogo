import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useTopology } from "./useTopology";

/**
 * Same pinned-clock fixture pattern as `setupStreamFixture`
 * (`@ksp-gonogo/components/src/test/setupStreamFixture.tsx`) — inlined here
 * so `@ksp-gonogo/data`'s tests don't reach across to `@ksp-gonogo/components`
 * (see `useDataSeries.shim.test.tsx`'s identical `buildStreamFixture`).
 */
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

function vesselPartsWire(partCount: number) {
  return {
    parts: Array.from({ length: partCount }, (_, i) => ({
      id: String(i + 1),
      parentId: i === 0 ? undefined : "1",
      name: `part-${i}`,
      title: `Part ${i}`,
      position: { x: 0, y: -i, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Pods",
      modules: [],
      isRobotics: false,
      isPowerRelated: false,
    })),
  };
}

function Probe() {
  const topology = useTopology();
  if (!topology) return <div data-testid="topology">undefined</div>;
  return (
    <div data-testid="topology">
      root:{topology.rootFlightId}|count:{topology.parts.length}
    </div>
  );
}

function readProbe(): string {
  return screen.getByTestId("topology").textContent ?? "";
}

describe("useTopology", () => {
  it("is undefined until vessel.parts arrives", () => {
    const fixture = buildStreamFixture();
    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );
    expect(readProbe()).toBe("undefined");
  });

  it("derives the legacy VesselTopology shape off a real vessel.parts emission", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.parts")).toBe(true);

    act(() => {
      fixture.transport.emit("vessel.parts", vesselPartsWire(3));
    });

    await waitFor(() => expect(readProbe()).toBe("root:1|count:3"));
  });

  it("updates on the next vessel.parts emission (no seq gating needed — the channel is itself change-gated)", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 10 });
    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );

    act(() => fixture.transport.emit("vessel.parts", vesselPartsWire(3)));
    await waitFor(() => expect(readProbe()).toBe("root:1|count:3"));

    act(() => fixture.transport.emit("vessel.parts", vesselPartsWire(8)));
    await waitFor(() => expect(readProbe()).toBe("root:1|count:8"));
  });

  it("stays undefined with no TelemetryProvider mounted — no legacy fallback any more", () => {
    render(<Probe />);
    expect(readProbe()).toBe("undefined");
  });
});
