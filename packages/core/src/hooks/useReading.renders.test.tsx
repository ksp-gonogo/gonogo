import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality, type TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useReading } from "./useReading";

/**
 * Render-count guard for `useReading`.
 *
 * This exists because the suite could not previously express "this re-renders
 * when nothing changed", and the first version of `sampleReading` did exactly
 * that: it built a new `Reading` object per frame, so `useSyncExternalStore`
 * saw a changed snapshot and re-rendered every telemetry widget at frame
 * cadence forever. Every other test passed. The values were right, the branches
 * were right, nothing was red, and it would have surfaced much later as "the
 * dashboard feels heavy" on a foundation everything else was built on.
 *
 * A number nobody asserts is a number that drifts, so the count is asserted.
 */

const TARGET = {
  name: "Mun",
  kind: 0,
} as unknown as TopicPayload<"vessel.target">;

function setup() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
  let renders = 0;

  function Probe() {
    renders += 1;
    const reading = useReading("vessel.target");
    return <div>state:{reading.state}</div>;
  }

  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );

  return { transport, store, count: () => renders };
}

describe("useReading render cost", () => {
  it("does not re-render on frames where nothing arrived", () => {
    const { transport, store, count } = setup();

    act(() => {
      transport.emit("vessel.target", TARGET, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
      store.beginFrame();
    });
    const settled = count();
    expect(screen.getByText("state:observed")).toBeTruthy();

    // Thirty quiet frames. At 60 Hz this is half a second of an idle dashboard,
    // which is the steady state a mission spends nearly all of its time in.
    act(() => {
      for (let i = 0; i < 30; i++) store.beginFrame();
    });

    expect(count()).toBe(settled);
  });

  it("does not re-render when a different topic changes", () => {
    const { transport, store, count } = setup();

    act(() => {
      transport.emit("vessel.target", TARGET, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
      store.beginFrame();
    });
    const settled = count();

    act(() => {
      transport.emit(
        "vessel.orbit",
        { referenceBodyIndex: 1 } as unknown as TopicPayload<"vessel.orbit">,
        { quality: Quality.Loaded, source: "vessel:1" },
      );
      store.beginFrame();
    });

    expect(count()).toBe(settled);
  });

  it("does re-render when the link drops, because the reading genuinely changed", () => {
    // The other half of the guard: a version that froze identity too
    // aggressively would pass the tests above and go on rendering a dead value
    // as current, which is the failure the whole type exists to prevent.
    const { transport, store, count } = setup();

    act(() => {
      transport.emit("vessel.target", TARGET, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
      store.beginFrame();
    });
    const settled = count();

    act(() => {
      store.setTransportConnected(false);
      store.beginFrame();
    });

    expect(count()).toBeGreaterThan(settled);
    expect(screen.getByText("state:stale")).toBeTruthy();
  });
});
