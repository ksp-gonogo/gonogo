import { Quality } from "@gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useStream } from "./use-stream";
import type { VesselFlightPayload, VesselOrbitPayload } from "./vessel-state";

/**
 * The M2 bridge task's core proof, at the `@gonogo/sitrep-client` layer
 * (independent of `@gonogo/core`'s `useDataValue` shim, which has its own
 * end-to-end test): before this task, NOTHING fed a `TimelineStore` in
 * production, so `vessel.state.*` (derived) topics were permanently
 * unreachable through `useStream`/`useDataValue` even with a
 * `TelemetryProvider` mounted — the derivation machinery in
 * `vessel-state.ts`/`timeline-store.ts` existed but was wired to nothing.
 *
 * `TelemetryProvider` now auto-builds a `TimelineStore`, registers the
 * production derived channels (`vesselStateChannel`), and feeds it from the
 * client's wire — so `useStream("vessel.state.<field>")` resolves through
 * the SAME provider a raw-topic `useStream` call already worked through.
 */

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

function Altitude() {
  const alt = useStream<number | null>("vessel.state.altitudeAsl");
  return <div>alt:{alt === undefined ? "—" : String(alt)}</div>;
}

describe("TelemetryProvider bridges client -> TimelineStore -> useStream for derived vessel.state.* topics", () => {
  it("resolves a derived field through useStream, given only `client` (the store is auto-created)", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <Altitude />
      </TelemetryProvider>,
    );

    expect(screen.getByText("alt:—")).toBeTruthy();

    // Ref-counting (Fix 1 item 3): subscribing the derived topic must have
    // subscribed its declared INPUTS on the wire, never the (server-unknown)
    // derived topic name itself.
    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(transport.isSubscribed("vessel.flight")).toBe(true);
    expect(transport.isSubscribed("vessel.state.altitudeAsl")).toBe(false);

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
    // frame (M2 finalization Fix 1), so the derived read resolves one frame
    // after the emits, not synchronously.
    await waitFor(() => expect(screen.getByText("alt:71234")).toBeTruthy());

    // Unsubscribe symmetry: unmounting releases both ref-counted raw inputs.
    unmount();
    expect(transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(transport.isSubscribed("vessel.flight")).toBe(false);
  });

  it("still resolves an ordinary raw (non-derived) topic exactly as before", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Raw() {
      const v = useStream<number>("v.raw");
      return <div>raw:{v ?? "—"}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Raw />
      </TelemetryProvider>,
    );

    expect(screen.getByText("raw:—")).toBeTruthy();
    act(() => transport.emit("v.raw", 42));
    await waitFor(() => expect(screen.getByText("raw:42")).toBeTruthy());
  });
});
