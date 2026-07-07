import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselFlightPayload,
  type VesselOrbitPayload,
} from "@gonogo/sitrep-client";
import { Quality } from "@gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataValue } from "./useDataValue";

// Minimal in-memory legacy DataSource — same shape as useDataValue.test.ts's
// fixture, reused here to drive the "falls back to the legacy path" side of
// the shim.
function makeLegacySource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & {
    emit: (key: string, value: unknown) => void;
    setStatus: (s: DataSourceStatus) => void;
  } = {
    id,
    name: id,
    status: "connected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribe(key, cb) {
      if (!dataListeners.has(key)) dataListeners.set(key, new Set());
      dataListeners.get(key)?.add(cb);
      return () => dataListeners.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    emit(key, value) {
      dataListeners.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
    setStatus(s) {
      source.status = s;
      statusListeners.forEach((cb) => {
        cb(s);
      });
    },
  };
  return source;
}

const ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

const FLIGHT: VesselFlightPayload = {
  latitude: -0.05,
  longitude: 42.3,
  altitudeAsl: 71_234,
  altitudeTerrain: 71_234,
  verticalSpeed: 12.5,
  surfaceSpeed: 1780.2,
  orbitalSpeed: 1790.9,
  gForce: 1.1,
  dynamicPressureKPa: 3.2,
  mach: 5.1,
  atmDensity: 0.01,
};

beforeEach(() => clearRegistry());

describe("useDataValue shim — mapped key routes to useStream when a TelemetryProvider is mounted", () => {
  it(
    "the M2 bridge's key end-to-end proof: 'v.altitude' (-> vessel.state.altitudeAsl, a DERIVED " +
      "channel) resolves through the real client -> TimelineStore -> hooks pipeline once real " +
      "vessel.orbit/vessel.flight wire frames arrive — RED before the bridge (permanently dead " +
      "undefined, since nothing fed a TimelineStore in production), GREEN after it",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useDataValue("data", "v.altitude");
        return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
      }

      render(
        // M3 Wave 0 carried-channels gate (`m3-migration-plan.md` §5.1): a
        // mapped topic only routes to the stream once its raw inputs are
        // actually carried. `StubTransport` doesn't declare
        // `carriedChannels` (it's test-scriptable, not a real serving
        // guarantee), so this test explicitly promotes the two raw inputs
        // `vessel.state.altitudeAsl` resolves to — the "dev-first per-topic
        // opt-in" half of the gate. Without this, the mapped topic would
        // stay on the legacy path and the rest of this test (which proves
        // the DERIVED-channel wiring) would never even exercise the stream.
        // See `useDataValue gate — carried-channels allowlist` below for the
        // gate's own dedicated coverage.
        <TelemetryProvider
          client={client}
          carriedChannels={["vessel.orbit", "vessel.flight"]}
        >
          <Alt />
        </TelemetryProvider>,
      );

      // Undefined-while-loading — the same contract widgets already rely on.
      expect(screen.getByText("alt:—")).toBeTruthy();

      // Derived-input ref-counting (Fix 1 item 3): subscribing the mapped
      // DERIVED topic must have subscribed its declared raw INPUTS on the
      // wire — never the derived topic name itself, which no server channel
      // ever produces.
      expect(transport.isSubscribed("vessel.orbit")).toBe(true);
      expect(transport.isSubscribed("vessel.flight")).toBe(true);
      expect(transport.isSubscribed("vessel.state.altitudeAsl")).toBe(false);

      // Feeding the legacy DataSource must NOT surface — the mapped key is
      // routed to the stream, so the old path is bypassed entirely.
      act(() => legacySource.emit("v.altitude", 999));
      expect(screen.getByText("alt:—")).toBeTruthy();

      // Feed REAL wire frames for the channel's actual inputs — orbit at
      // Loaded quality (so altitudeAsl comes off the measured vessel.flight
      // basis) plus the flight measurement itself. This is what the derived
      // vessel.state channel actually propagates from.
      act(() => {
        transport.emit("vessel.orbit", ORBIT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
        transport.emit("vessel.flight", FLIGHT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
      });

      // `TelemetryProvider` coalesces `beginFrame()` to the next animation
      // frame (sitrep-client M2 finalization Fix 1) rather than minting one
      // per ingest, so the derived read resolves one frame after the emits,
      // not synchronously.
      await waitFor(() => expect(screen.getByText("alt:71234")).toBeTruthy());
    },
  );
});

describe("useDataValue shim — unmapped key falls back to the legacy DataSource path even with a provider mounted", () => {
  it("a known-gap key ('career.funds') ignores the TelemetryClient and reads the legacy DataSource", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Funds() {
      const funds = useDataValue("data", "career.funds");
      return <div>funds:{funds === undefined ? "—" : String(funds)}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Funds />
      </TelemetryProvider>,
    );

    expect(screen.getByText("funds:—")).toBeTruthy();

    // A sample on the new SDK for an unmapped key must have no effect.
    act(() => transport.emit("career.funds", 500));
    expect(screen.getByText("funds:—")).toBeTruthy();

    // The legacy DataSource is what still drives it.
    act(() => legacySource.emit("career.funds", 289_848));
    expect(screen.getByText("funds:289848")).toBeTruthy();
  });
});

describe("useDataValue shim — no TelemetryProvider mounted behaves exactly like the pre-shim hook", () => {
  it("a mapped key with no provider in the tree still reads the legacy DataSource (unmigrated screens keep working)", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    // No <TelemetryProvider> wrapper at all — this is every screen today.
    const { result } = renderHook(() => useDataValue("data", "v.altitude"));

    expect(result.current).toBeUndefined();
    act(() => source.emit("v.altitude", 80_000));
    expect(result.current).toBe(80_000);
  });

  it("clears to undefined on disconnect — the legacy-path contract is untouched by the shim", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() => useDataValue("data", "v.altitude"));
    act(() => source.emit("v.altitude", 80_000));
    expect(result.current).toBe(80_000);

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBeUndefined();
  });
});

describe("useDataValue gate — M3 Wave 0 carried-channels allowlist (the big-bang blank-out fix, m3-migration-plan.md §5.1)", () => {
  it(
    "a MAPPED topic NOT in carriedChannels reads the LEGACY value, never a blank — " +
      "RED before the gate (mapped + provider mounted always won, permanently blanking an unserved topic), GREEN after",
    () => {
      const client = new TelemetryClient(new StubTransport());
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useDataValue("data", "v.altitude");
        return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
      }

      // No `carriedChannels` prop at all — 'v.altitude' maps to a DERIVED
      // topic (`vessel.state.altitudeAsl`) whose inputs are not carried.
      render(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );

      expect(screen.getByText("alt:—")).toBeTruthy();

      // Legacy still drives the read — this is the crux of the fix: before
      // the gate, mapping + a mounted provider always won, so this legacy
      // emit would have had NO effect and the widget would render blank
      // forever even though a perfectly good legacy value exists.
      act(() => legacySource.emit("v.altitude", 80_000));
      expect(screen.getByText("alt:80000")).toBeTruthy();
    },
  );

  it("a MAPPED topic IN carriedChannels streams (never falls back to legacy)", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Throttle() {
      const throttle = useDataValue("data", "f.throttle");
      return (
        <div>throttle:{throttle === undefined ? "—" : String(throttle)}</div>
      );
    }

    render(
      // Promoting "vessel.control" — the REAL raw wire topic ("f.throttle"
      // maps to the raw-field subtopic "vessel.control.throttle", which
      // TimelineStore.resolveSubscriptionTopics resolves down to its actual
      // wire dependency, "vessel.control" — see the M3 pilot's
      // timeline-store-raw-fields.test.ts). The wire never publishes a
      // literal "vessel.control.throttle" topic; only the whole
      // "vessel.control" record does.
      <TelemetryProvider client={client} carriedChannels={["vessel.control"]}>
        <Throttle />
      </TelemetryProvider>,
    );

    expect(screen.getByText("throttle:—")).toBeTruthy();

    // Legacy emits must NOT surface — the carried topic is routed to the
    // stream, bypassing legacy entirely.
    act(() => legacySource.emit("f.throttle", 0.4));
    expect(screen.getByText("throttle:—")).toBeTruthy();

    // Emitting to the real raw topic ("vessel.control", a whole record) —
    // never the never-published dotted field string.
    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    await waitFor(() => expect(screen.getByText("throttle:0.75")).toBeTruthy());
  });

  it("a DERIVED topic is carried only when ALL of its inputs are carried — one carried input is not enough", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Alt() {
      const alt = useDataValue("data", "v.altitude");
      return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
    }

    render(
      // Only ONE of vessel.state.altitudeAsl's two declared inputs
      // (vessel.orbit, vessel.flight) is promoted.
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Alt />
      </TelemetryProvider>,
    );

    expect(screen.getByText("alt:—")).toBeTruthy();

    // Still legacy — the derived channel can never produce a whole record
    // with a missing input, so it must not be treated as carried.
    act(() => legacySource.emit("v.altitude", 12_345));
    expect(screen.getByText("alt:12345")).toBeTruthy();

    // Feeding the (partially) carried input must not flip it to streamed —
    // the legacy value must keep winning.
    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });
    expect(screen.getByText("alt:12345")).toBeTruthy();
  });

  it(
    "MONOTONIC: promoting a topic flips legacy -> stream, and a later render that omits the " +
      "promotion does NOT flip it back to legacy mid-session",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useDataValue("data", "v.altitude");
        return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
      }

      const { rerender } = render(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );

      // Not yet carried — legacy drives it.
      act(() => legacySource.emit("v.altitude", 1));
      expect(screen.getByText("alt:1")).toBeTruthy();

      // Promote both inputs.
      rerender(
        <TelemetryProvider
          client={client}
          carriedChannels={["vessel.orbit", "vessel.flight"]}
        >
          <Alt />
        </TelemetryProvider>,
      );

      act(() => {
        transport.emit("vessel.orbit", ORBIT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
        transport.emit("vessel.flight", FLIGHT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
      });
      await waitFor(() => expect(screen.getByText("alt:71234")).toBeTruthy());

      // A later render whose `carriedChannels` prop OMITS the promotion
      // entirely must not un-carry it — the allowlist only ever grows for
      // the life of this mounted provider.
      rerender(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );
      expect(screen.getByText("alt:71234")).toBeTruthy();

      // And legacy emits still must not surface, proving it's genuinely
      // still on the stream path, not coincidentally matching.
      act(() => legacySource.emit("v.altitude", 999));
      expect(screen.getByText("alt:71234")).toBeTruthy();
    },
  );
});
