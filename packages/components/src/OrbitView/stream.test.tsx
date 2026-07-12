import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView genuinely runs OFF THE STREAM — a real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`, no legacy `DataSource` anywhere.
 *
 * Every read is now stream-native:
 * - `vessel.orbit` (raw Topic) → `sma`/`ecc`/`argPe`.
 * - `vessel.state` (derived channel) → `trueAnomaly` (propagated at view-UT)
 *   and `parentBodyName` (identity index → `system.bodies` name).
 * - Apsis radii are computed in-widget off the raw elements (`sma·(1±ecc)`).
 *
 * Because the apsis radii now come off `vessel.orbit` alone, `hasOrbit` goes
 * true and the diagram renders — the exact opposite of the pre-migration
 * correlated-gap behaviour, where those keys were gapped and the widget could
 * never leave its empty state off the stream.
 */
afterEach(() => {
  cleanup();
});

describe("OrbitView — genuinely runs off the stream (R6 de-Telemachus)", () => {
  it("renders the orbit diagram off the real stream pipeline, not legacy", async () => {
    const { container, fixture } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    );

    // A real subscription must have happened for StubTransport to deliver at
    // all (its emit is subscription-gated — see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    await waitFor(() => {
      if (container.textContent?.includes("No orbital data")) {
        throw new Error("orbit has not resolved off the stream yet");
      }
    });

    // The diagram is up — the widget left its empty state purely from
    // stream-derived data.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Kerbin");

    // White-box: the parentBodyName the widget reads is genuinely derived off
    // the real TimelineStore (mirroring the store.sample the widget's own read
    // makes), not fabricated.
    const parentBodyName = fixture.store.sample<string>(
      "vessel.state.parentBodyName",
      fixture.store.currentFrame(),
    );
    expect(parentBodyName?.payload).toBe("Kerbin");
  });
});
