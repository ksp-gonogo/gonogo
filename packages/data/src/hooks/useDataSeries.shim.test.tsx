import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BufferedDataSource } from "../BufferedDataSource";
import { MemoryStore } from "../storage/MemoryStore";
import { useDataSeries } from "./useDataSeries";

/**
 * The M3 `useDataSeries` shim (the last M3 read-side unlock): mirrors
 * `@ksp-gonogo/core`'s `useDataValue.shim.test.tsx` pattern one level up — a
 * MAPPED + CARRIED key builds its `SeriesRange` from the `TimelineStore`'s
 * `ClientTimeline` (via `TimelineStore.sampleRange`,
 * `timeline-store-sample-range.test.ts`) instead of the legacy
 * `BufferedDataSource`'s buffered series, with the exact same `{ t, v }`
 * return shape so no consumer changes. Everything else (unmapped,
 * uncarried, no provider, derived topics with no stored range) falls back
 * to the legacy `subscribeSamples`/`queryRange` path unchanged.
 */

function Probe({ dataKey, windowSec }: { dataKey: string; windowSec: number }) {
  const range = useDataSeries("data", dataKey, windowSec);
  return (
    <div data-testid="range">
      t:{range.t.join(",")}|v:{range.v.join(",")}
    </div>
  );
}

function readProbe(): string {
  return screen.getByTestId("range").textContent ?? "";
}

/**
 * Same pinned-clock fixture pattern as `setupStreamFixture`
 * (`@ksp-gonogo/components/src/test/setupStreamFixture.tsx`) — inlined here so
 * `@ksp-gonogo/data`'s tests don't reach across to `@ksp-gonogo/components`.
 */
function buildStreamFixture(opts: {
  carriedChannels: Iterable<string>;
  pinnedUt?: number;
}) {
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
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={opts.carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

/**
 * The legacy `"data"` registry slot `useDataSeries`'s un-shimmed half always
 * subscribes to (stable hook order — see `useDataSeries.ts`'s own doc),
 * regardless of whether the stream side ends up winning. Every test in this
 * file registers one so a mapped+carried case can prove the legacy source
 * genuinely has zero effect, not merely that nothing happened to register.
 */
async function buildLegacySource(key: string) {
  const source = new MockDataSource({
    keys: [{ key }, { key: "v.name" }, { key: "v.missionTime" }],
  });
  const buffered = new BufferedDataSource({ source, store: new MemoryStore() });
  registerDataSource(buffered);
  await buffered.connect();
  // Establish a flight — BufferedDataSource only fans a sample out to
  // `subscribeSamples` once `FlightDetector` has a current flight (see
  // `useDataSeries.test.tsx`'s identical beforeEach seeding).
  source.emit("v.name", "KX");
  source.emit("v.missionTime", 0);
  return source;
}

beforeEach(() => clearRegistry());
afterEach(() => cleanup());

describe("useDataSeries shim — mapped + carried key streams from the ClientTimeline", () => {
  it("builds the series from the real TimelineStore, not the legacy DataSource — RED before the shim, GREEN after", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 100,
    });
    const legacySource = await buildLegacySource("o.sma");

    render(
      <fixture.Provider>
        <Probe dataKey="o.sma" windowSec={300} />
      </fixture.Provider>,
    );

    // Nothing arrived on the stream yet — empty, matching the legacy hook's
    // pre-backfill empty state.
    expect(readProbe()).toBe("t:|v:");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    // Feeding the legacy source must have NO effect — the mapped+carried key
    // bypasses it entirely.
    act(() => legacySource.emit("o.sma", 999_999));
    expect(readProbe()).toBe("t:|v:");

    act(() => {
      fixture.transport.emit("vessel.orbit", { sma: 679_400 }, { validAt: 10 });
      fixture.transport.emit("vessel.orbit", { sma: 679_800 }, { validAt: 50 });
      fixture.transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { validAt: 100 },
      );
    });

    await waitFor(() =>
      expect(readProbe()).toBe("t:10,50,100|v:679400,679800,680000"),
    );
    // Still never leaked the legacy value in.
    expect(readProbe()).not.toContain("999999");
  });

  it("trims to the window, off real buffered timeline data", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 1000,
    });
    await buildLegacySource("o.sma");

    render(
      <fixture.Provider>
        <Probe dataKey="o.sma" windowSec={100} />
      </fixture.Provider>,
    );

    act(() => {
      // Well outside the [900, 1000] window pinned above.
      fixture.transport.emit("vessel.orbit", { sma: 1 }, { validAt: 10 });
      fixture.transport.emit("vessel.orbit", { sma: 2 }, { validAt: 950 });
      fixture.transport.emit("vessel.orbit", { sma: 3 }, { validAt: 1000 });
    });

    await waitFor(() => expect(readProbe()).toBe("t:950,1000|v:2,3"));
  });
});

describe("useDataSeries shim — a DERIVED mapped topic (no stored range) falls back to legacy", () => {
  it("'v.altitude' maps to the DERIVED vessel.state.altitudeAsl — TimelineStore.sampleRange returns undefined for it, so the series stays on legacy even though the topic is carried", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit", "vessel.flight"],
      pinnedUt: 50,
    });
    const legacySource = await buildLegacySource("v.altitude");

    render(
      <fixture.Provider>
        <Probe dataKey="v.altitude" windowSec={100} />
      </fixture.Provider>,
    );

    expect(readProbe()).toBe("t:|v:");

    // A stream emission on the derived channel's own inputs must NOT surface
    // as a series point — there is no stored range for a derived topic.
    act(() => {
      fixture.transport.emit("vessel.orbit", { sma: 700_000 }, { validAt: 10 });
    });
    expect(readProbe()).toBe("t:|v:");

    // The legacy DataSource is what actually drives it.
    act(() => legacySource.emit("v.altitude", 71_234));
    await waitFor(() => expect(readProbe()).toContain("71234"));
  });
});

describe("useDataSeries shim — unmapped/uncarried keys and no-provider behave exactly like the pre-shim hook", () => {
  it("an unmapped key ('career.funds' — not in the migration table) ignores the stream and reads legacy", async () => {
    const fixture = buildStreamFixture({ carriedChannels: [] });
    const legacySource = await buildLegacySource("career.funds");

    render(
      <fixture.Provider>
        <Probe dataKey="career.funds" windowSec={60} />
      </fixture.Provider>,
    );

    act(() => legacySource.emit("career.funds", 5000));
    await waitFor(() => expect(readProbe()).toContain("5000"));
  });

  it("a mapped key NOT in carriedChannels reads the legacy series, never a permanent blank", async () => {
    const fixture = buildStreamFixture({ carriedChannels: [] }); // 'o.sma' is mapped but not carried here
    const legacySource = await buildLegacySource("o.sma");

    render(
      <fixture.Provider>
        <Probe dataKey="o.sma" windowSec={60} />
      </fixture.Provider>,
    );

    act(() => legacySource.emit("o.sma", 680_000));
    await waitFor(() => expect(readProbe()).toContain("680000"));
  });

  it("no TelemetryProvider in the tree at all — a mapped key still reads legacy (every unmigrated screen today)", async () => {
    const legacySource = await buildLegacySource("o.sma");

    render(<Probe dataKey="o.sma" windowSec={60} />);

    act(() => legacySource.emit("o.sma", 680_000));
    await waitFor(() => expect(readProbe()).toContain("680000"));
  });
});
