import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

/**
 * EscapeProfile's R6 de-Telemachus stream proof.
 *
 * Its one direct read, `v.body`, migrated onto the derived
 * `vessel.state.parentBodyName` display map (`vessel.identity.parentBodyIndex`
 * resolved against `system.bodies`). This test runs the widget OFF THE STREAM
 * — a real `TelemetryProvider`/`TimelineStore` pipeline, NO legacy `"data"`
 * source — and proves the streamed body name actually reaches the widget:
 * emitting `vessel.identity` + `system.bodies` for a body the stock registry
 * doesn't know surfaces the widget's "Unknown body" Notice with that exact
 * name. If the read had silently fallen back to a (nonexistent) legacy source
 * the body would stay `undefined` and no Notice would render.
 *
 * The plot's trace (`v.altitude`/`v.orbitalVelocity` via `GraphView`) can't
 * stream — both map to DERIVED `vessel.state.*` field-subtopics that
 * `TimelineStore.isDerivedTopic` gates out of `sampleRange` — and `GraphView`'s
 * SVG renders nothing under jsdom regardless, so this asserts on the title +
 * body-driven Notice only.
 */
afterEach(() => {
  cleanup();
});

// vessel.state's carried-channels gate is parent-channel-scoped: every
// vessel.state.* field needs ALL of vesselStateChannel.inputs carried, not just
// the two parentBodyName consults.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

describe("EscapeProfile — reads v.body off the stream (R6)", () => {
  it("surfaces the streamed body name in the Unknown-body notice, with no legacy source", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "escape-stream" }}>
          <EscapeProfileComponent id="escape-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // "Proxima" is not a stock body, so a resolved streamed name drives the
    // widget's Unknown-body Notice — an observable proof the value streamed.
    // vessel.orbit gates the whole derived vessel.state record (deriveVesselState),
    // so it must be present for parentBodyName to resolve at all.
    act(() => {
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 3,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        mu: 3.5316e12,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        encounter: null,
      });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Proxima",
            index: 3,
            parentIndex: 0,
            radius: 700_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 3 });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Unknown body")) {
        throw new Error("streamed body name has not reached the widget yet");
      }
    });

    expect(container.textContent).toContain("ESCAPE PROFILE");
    expect(container.textContent).toContain("Unknown body “Proxima”");
  });
});
