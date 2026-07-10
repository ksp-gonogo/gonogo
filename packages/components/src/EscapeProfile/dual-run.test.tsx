import { DashboardItemContext, registerStockBodies } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinEscape from "./__fixtures__/kerbin-escape-trajectory.json";
import { EscapeProfileComponent } from "./index";

/**
 * EscapeProfile's R6 de-Telemachus behavior-preservation golden dual-run.
 *
 * Its one direct read, `v.body`, is now a clean home — the derived
 * `vessel.state.parentBodyName` display map (`vessel.identity.parentBodyIndex`
 * resolved against `system.bodies`). So the STREAM leg feeds it purely off the
 * stream (emit `vessel.identity` + `system.bodies`) with **no legacy `"data"`
 * MockDataSource leg at all** — the R6 read-fallback drop for this widget.
 *
 * `v.altitude`/`v.orbitalVelocity` are read only via `GraphView` ->
 * `useDataSeries`, and both map to DERIVED `vessel.state.*` field-subtopics
 * that `TimelineStore.isDerivedTopic` gates out of `sampleRange` (a derived
 * value is computed per-frame, never buffered as history) — so the plot's
 * trace can never stream. That's invisible here regardless: `GraphView`'s
 * ResizeObserver-driven SVG renders nothing under jsdom (see the committed
 * `snapshots.test.tsx.snap` — every fixture reduces to the title + an empty
 * plot `<div>`), so the widget's testable DOM is the title plus the body-driven
 * Notice. Proving `v.body` streams (Kerbin resolves -> no Notice) byte-matches
 * the legacy render is the whole behavior this golden locks in.
 */
afterEach(() => {
  cleanup();
});

// vessel.state's carried-channels gate is parent-channel-scoped — every
// vessel.state.* field needs ALL of vesselStateChannel.inputs carried, even the
// ones (here, all but vessel.identity/system.bodies) parentBodyName never
// consults.
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

describe("EscapeProfile — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same escape-trajectory state", async () => {
    const mode = { name: "default-10x8", w: 10, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: EscapeProfileComponent,
      fixture: kerbinEscape,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
    // The widget resolves the streamed body NAME through the global body
    // registry (getBody) — same as the legacy snapshot helper does.
    registerStockBodies();

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "escape-dual" }}>
          <EscapeProfileComponent id="escape-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      // vessel.orbit gates the whole derived vessel.state record
      // (deriveVesselState), so it must be present for parentBodyName to resolve.
      streamFixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
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
      streamFixture.emit("system.bodies", {
        bodies: [
          {
            name: kerbinEscape["v.body"],
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      streamFixture.emit("vessel.identity", { parentBodyIndex: 1 });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("ESCAPE PROFILE")) {
        throw new Error("widget has not rendered yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
