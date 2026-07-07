import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselFlightPayload,
  type VesselOrbitPayload,
} from "@gonogo/sitrep-client";
import { Quality } from "@gonogo/sitrep-sdk";
import { act, render, renderHook, screen } from "@testing-library/react";
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
    () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useDataValue("data", "v.altitude");
        return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
      }

      render(
        <TelemetryProvider client={client}>
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

      expect(screen.getByText("alt:71234")).toBeTruthy();
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
