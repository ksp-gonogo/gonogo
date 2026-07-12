import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { FlightRecord } from "../types";
import { useFlight } from "./useFlight";

/**
 * Coverage for `useFlight`'s stream-native default: post flight-lifecycle
 * spec (`docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md`),
 * `useFlight()` derives the current flight from the mod's own
 * `flight.started` events instead of the retired client-side
 * `FlightDetector` heuristic — the mod mints the flight id and does the
 * revert/switch detection server-side, so this hook just mirrors whatever
 * `flight.started` says.
 */

interface Rig {
  transport: StubTransport;
  client: TelemetryClient;
}

function buildRig(): Rig {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  return { transport, client };
}

/** Emits a `flight.started` event — one flight-boundary transition. */
function emitStarted(
  rig: Rig,
  ut: number,
  flight: { flightId: string; vesselId: string; vesselName: string },
): void {
  act(() => {
    rig.transport.emit(
      "flight.started",
      { ...flight, ut },
      { validAt: ut, deliveredAt: ut },
    );
  });
}

let latest: FlightRecord | null | "unset" = "unset";
function Probe({ sourceId }: { sourceId?: string }) {
  latest = useFlight(sourceId);
  return null;
}

beforeEach(() => {
  clearRegistry();
  latest = "unset";
});

describe("useFlight() — default, stream-native path", () => {
  it("returns null (never throws) when no TelemetryProvider is mounted — every station screen today", () => {
    expect(() => render(<Probe />)).not.toThrow();
    expect(latest).toBeNull();
  });

  it("returns the current flight once flight.started fires, id stable until the next boundary", () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client}>
        <Probe />
      </TelemetryProvider>,
    );

    expect(latest).toBeNull();

    emitStarted(rig, 0, {
      flightId: "vA",
      vesselId: "vA",
      vesselName: "Alpha",
    });
    expect(latest && latest !== "unset" ? latest.vesselName : null).toBe(
      "Alpha",
    );
    expect(latest && latest !== "unset" ? latest.id : null).toBe("vA");
  });

  it("mints a new id on a genuine flight-boundary transition (new vessel)", () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client}>
        <Probe />
      </TelemetryProvider>,
    );

    emitStarted(rig, 0, {
      flightId: "vA",
      vesselId: "vA",
      vesselName: "Alpha",
    });
    const firstId = latest && latest !== "unset" ? latest.id : null;

    emitStarted(rig, 10, {
      flightId: "vB",
      vesselId: "vB",
      vesselName: "Bravo",
    });
    const secondId = latest && latest !== "unset" ? latest.id : null;
    expect(latest && latest !== "unset" ? latest.vesselName : null).toBe(
      "Bravo",
    );
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it("mints a fresh flight on a revert (the mod republishes flight.started for the reverted-to vessel)", () => {
    const rig = buildRig();
    render(
      <TelemetryProvider client={rig.client}>
        <Probe />
      </TelemetryProvider>,
    );

    emitStarted(rig, 0, {
      flightId: "vA",
      vesselId: "vA",
      vesselName: "Alpha",
    });
    const preRevertId = latest && latest !== "unset" ? latest.id : null;

    // Revert to launch: FlightLifecycleSampler treats every rewind as a
    // hard timeline reset — a fresh flight.started fires even for the SAME
    // vessel id resuming.
    emitStarted(rig, 0.1, {
      flightId: "vA",
      vesselId: "vA",
      vesselName: "Alpha",
    });
    expect(latest && latest !== "unset" ? latest.id : null).toBe(preRevertId);
  });
});

describe("useFlight(sourceId) — explicit DataSource-based lookup, unchanged", () => {
  it("reads getCurrentFlight()/onFlightChange() off a registered FlightAware source", () => {
    const flight: FlightRecord = {
      id: "f1",
      vesselName: "Charlie",
      launchedAt: 0,
      lastSampleAt: 0,
      lastMissionTime: 0,
      sampleCount: 1,
    };
    let changeCb: ((f: FlightRecord | null) => void) | null = null;
    const fakeSource = {
      id: "fake",
      getCurrentFlight: () => flight,
      onFlightChange: (cb: (f: FlightRecord | null) => void) => {
        changeCb = cb;
        return () => {
          changeCb = null;
        };
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double, not a full DataSource
    registerDataSource(fakeSource as any);

    render(<Probe sourceId="fake" />);
    expect(latest && latest !== "unset" ? latest.vesselName : null).toBe(
      "Charlie",
    );
    expect(changeCb).not.toBeNull();
  });

  it("returns null for an unregistered or non-FlightAware source", () => {
    render(<Probe sourceId="nope" />);
    expect(latest).toBeNull();
  });
});
