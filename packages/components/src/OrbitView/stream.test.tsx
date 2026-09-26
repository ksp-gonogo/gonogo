import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/**
 * OrbitView genuinely runs OFF THE STREAM, a real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`, no legacy `DataSource` anywhere.
 *
 * Every read is stream-native:
 * - `vessel.orbit` (raw Topic) → `sma`/`ecc`/`argPe`.
 * - the orbit solve over those elements → `trueAnomaly` (propagated at
 *   view-UT) and the apsis radii (`apoapsisRadius`/`periapsisRadius`: `null`
 *   on a hyperbolic orbit, real as soon as `vessel.orbit` lands otherwise).
 * - the parent body name → `vessel.identity.parentBodyIndex` named against
 *   `system.bodies`.
 *
 * Because the periapsis radius resolves as soon as `vessel.orbit` lands
 * (OnRails), `hasOrbit` goes true and the diagram renders.
 */

describe("OrbitView: genuinely runs off the stream (R6)", () => {
  it("renders the orbit diagram off the real stream pipeline, not legacy", async () => {
    const { container, fixture } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    );

    // A real subscription must have happened for StubTransport to deliver at
    // all (its emit is subscription-gated; see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    await waitFor(() => {
      if (visibleText(container).includes("No orbital data")) {
        throw new Error("orbit has not resolved off the stream yet");
      }
    });

    // The diagram is up, the widget left its empty state purely from
    // stream-derived data.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(visibleText(container)).toContain("Kerbin");

    // White-box: the index the body name is resolved from is the one that
    // streamed into the real TimelineStore, not fabricated.
    const identity = fixture.store.sample<{ parentBodyIndex: number }>(
      "vessel.identity",
      fixture.store.currentFrame(),
    );
    expect(identity?.payload?.parentBodyIndex).toBe(0);
  });
});
