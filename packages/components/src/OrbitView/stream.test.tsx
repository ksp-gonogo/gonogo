import { waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { renderOrbitViewStream } from "./streamHarness";

/** OrbitView on the real provider pipeline via `StubTransport`: the periapsis radius resolves as soon as `vessel.orbit` lands, so the diagram renders. */

describe("OrbitView: genuinely runs off the stream (R6)", () => {
  it("renders the orbit diagram off the real stream pipeline, not legacy", async () => {
    const { container, fixture } = renderOrbitViewStream(
      { w: 9, h: 18 },
      { bodyName: "Kerbin", sma: 681_500, ecc: 0.003, argPe: 12 },
    );

    // StubTransport.emit is subscription-gated, so a real subscription must exist for this to deliver.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    await waitFor(() => {
      if (visibleText(container).includes("No orbital data")) {
        throw new Error("orbit has not resolved off the stream yet");
      }
    });

    expect(container.querySelector("svg")).not.toBeNull();
    expect(visibleText(container)).toContain("Kerbin");

    // The body name resolves from the index that streamed into the store.
    const identity = fixture.store.sample<{ parentBodyIndex: number }>(
      "vessel.identity",
      fixture.store.currentFrame(),
    );
    expect(identity?.payload?.parentBodyIndex).toBe(0);
  });
});
