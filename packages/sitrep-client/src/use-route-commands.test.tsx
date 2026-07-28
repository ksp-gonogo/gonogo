import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useRouteCommands } from "./use-route-commands";
import { ViewClock } from "./view-clock";

/**
 * Local, self-contained stream fixture (sitrep-client can't depend on
 * `@ksp-gonogo/components`' `setupStreamFixture` — this package sits
 * BELOW it in the dependency graph). Same `FixedViewClock` + `StubTransport`
 * pattern that fixture wraps, built directly from this package's own
 * exports (`createFakeWallClock`, `ViewClock`, `TimelineStore`,
 * `StubTransport`, `TelemetryClient`, `TelemetryProvider`).
 */
function setupFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  const carriedChannels = ["comms.delay", "system.uplink.pending"];

  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

function RouteCommandsProbe({ topic }: { topic: string }) {
  const { items, mode } = useRouteCommands(topic);
  return (
    <div>
      <span>mode:{mode}</span>
      <span>count:{items.length}</span>
      {items.map((item) => (
        <span key={item.id}>
          item:{item.id}:{item.predictedPhase}:{item.reachEtaSeconds}:
          {item.replyEtaSeconds}
        </span>
      ))}
    </div>
  );
}

describe("useRouteCommands", () => {
  it("scopes to the given topic, deriving phases at the fixture's nowUt, and reads mode from comms.delay", async () => {
    const fixture = setupFixture();
    render(
      <fixture.Provider>
        <RouteCommandsProbe topic="kos/7" />
      </fixture.Provider>,
    );

    // Emitting the pending queue with validAt/deliveredAt = 102 both
    // delivers the queue AND anchors the view clock's utNowEstimate() to
    // 102 (client.attachStore feeds every stream-data message's
    // validAt/deliveredAt into ViewClock.observeSample) — no wall-time
    // advance happens between this and the assertion below, so
    // utNowEstimate() reads back as exactly 102 once the coalesced
    // ingest -> beginFrame() microtask (see context.tsx's scheduleFrame)
    // has run, hence the waitFor below rather than a synchronous assertion.
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "r1",
              command: "kos.run",
              label: "boot",
              topic: "kos/7",
              vantage: "ksc",
              dispatchedAt: 100,
              oneWaySeconds: 4,
            },
            {
              id: "r2",
              command: "kos.run",
              label: "other route",
              topic: "kos/9",
              vantage: "ksc",
              dispatchedAt: 100,
              oneWaySeconds: 4,
            },
          ],
        },
        { validAt: 102, deliveredAt: 102 },
      );
      // Every ingested frame re-anchors the shared view clock (`ViewClock.
      // observeSample` is fed on EVERY topic's arrival, not just this one —
      // see `TimelineStore.ingest`'s doc) — so this emit must carry the same
      // validAt/deliveredAt as the pending-queue emit above, or it would
      // silently reset nowUt back to the wire default (0).
      fixture.transport.emit(
        "comms.delay",
        { oneWaySeconds: 4, source: "SignalDelay" },
        { validAt: 102, deliveredAt: 102 },
      );
    });

    expect(screen.getByText("mode:staged")).toBeTruthy();
    expect(screen.getByText("count:1")).toBeTruthy();
    // reach at 104, reply at 108, nowUt 102 -> in-transit, reachEta 2, replyEta 6.
    await waitFor(() =>
      expect(screen.getByText("item:r1:in-transit:2:6")).toBeTruthy(),
    );
  });

  it("reports no-path mode when comms.delay.oneWaySeconds is null (never 0)", () => {
    const fixture = setupFixture();
    render(
      <fixture.Provider>
        <RouteCommandsProbe topic="kos/7" />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit("comms.delay", {
        oneWaySeconds: null,
        source: "None",
      });
    });

    expect(screen.getByText("mode:no-path")).toBeTruthy();
  });

  it("returns an empty set with no pending entries for the topic", () => {
    const fixture = setupFixture();
    render(
      <fixture.Provider>
        <RouteCommandsProbe topic="kos/7" />
      </fixture.Provider>,
    );

    expect(screen.getByText("count:0")).toBeTruthy();
    expect(screen.getByText("mode:no-path")).toBeTruthy();
  });
});
