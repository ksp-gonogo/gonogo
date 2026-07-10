import {
  clearActionHandlers,
  DashboardItemContext,
  PerfBudget,
} from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import northLevel from "./__fixtures__/north-level.json";
import { NavballComponent } from "./index";

/**
 * Navball's M3 batch-1 behavior-preservation golden dual-run (mirrors
 * `WarpControl/dual-run.test.tsx`, the pilot): the SAME attitude/control
 * state, rendered once off the legacy `DataSource` and once off the stream,
 * must produce byte-identical DOM at `delay=0`.
 *
 * `north-level` is chosen because every key it sets is either MAPPED
 * (`n.heading`/`n.pitch`/`n.roll` -> `vessel.attitude.*`; `f.sasEnabled` ->
 * `vessel.control.sas`; `v.rcsValue` -> `vessel.control.rcs`; `f.throttle`
 * -> `vessel.control.throttle`; `f.precisionControl` ->
 * `vessel.control.precisionControl`, P4a un-gap) or a declared GAP this
 * widget always reads regardless of config (`v.isControllable`, and — as
 * of the M3 batch-2 fixture audit — `f.sasMode`, a shape-mismatch gap:
 * `vessel.control.sasMode` is a numeric `SasMode` enum on the real wire,
 * not the string the widget renders/compares against, see `map-topic.ts`)
 * — so the stream leg needs a legacy AUX source for exactly those two
 * gapped keys, registered alongside the `TelemetryProvider`, proving the
 * shim's MIXED-source coexistence (some keys stream, others legacy, same
 * render) exactly like the pilot.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Navball — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same attitude/control state", async () => {
    const mode = { name: "default-8x11", w: 8, h: 11 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: NavballComponent,
      fixture: northLevel,
      mode,
      connectSource: true,
    });

    // Navball registers ~30 actions via useActionInput — mounting it twice
    // in one test (legacy leg above, stream leg below) sums both mounts'
    // registrations against the same un-reset rolling window and trips the
    // `useActionInput register/sec` PerfBudget gate (threshold 50), which
    // WarpControl's own dual-run (4 actions) never hit. Reset between
    // mounts — the codebase's established idiom for this exact double-mount
    // shape (see useActionInput.test.tsx / MapView/predictionThrottle.test.tsx).
    PerfBudget.getAll()
      .find((b) => b.name.startsWith("useActionInput register"))
      ?.reset();

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.attitude", "vessel.control"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "v.isControllable" }, { key: "f.sasMode" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-dual" }}>
          <NavballComponent id="nav-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("v.isControllable", northLevel["v.isControllable"]);
      legacyAux.source.emit("f.sasMode", northLevel["f.sasMode"]);
      streamFixture.emit("vessel.attitude", {
        heading: northLevel["n.heading"],
        pitch: northLevel["n.pitch"],
        roll: northLevel["n.roll"],
      });
      streamFixture.emit("vessel.control", {
        sas: northLevel["f.sasEnabled"],
        // Real wire shape: numeric SasMode enum (0 = StabilityAssist,
        // matches north-level's "StabilityAssist" string) — f.sasMode
        // itself is a gap now (see map-topic.ts), so the widget's own
        // sasMode read comes from the legacyAux emit above, not this field.
        // Included so the stream payload matches the real contract shape.
        sasMode: 0,
        rcs: northLevel["v.rcsValue"],
        // f.precisionControl -> vessel.control.precisionControl (P4a
        // un-gap): now lands off the stream, not the legacyAux.
        precisionControl: northLevel["f.precisionControl"],
        throttle: northLevel["f.throttle"],
      });
    });

    await waitFor(() => {
      // "StabilityAssist" alone no longer proves the STREAM leg landed — as
      // of the M3 batch-2 fixture audit it comes from the separate,
      // synchronous legacyAux emit (f.sasMode is now a gap), so it can settle
      // before the async stream delivery of vessel.attitude/vessel.control
      // does. AttitudeIndicator's own HDG/PIT/ROL readout
      // (AttitudeIndicator.tsx) shows "—" until heading/pitch/roll actually
      // resolve, so its absence is the real "stream leg landed" signal —
      // checked alongside "StabilityAssist" so both legs of this
      // mixed-source render are proven settled before the snapshot below.
      const streamAttitudeResolved = !container.textContent?.includes("—");
      if (
        !streamAttitudeResolved ||
        !container.textContent?.includes("StabilityAssist")
      ) {
        throw new Error("stream leg has not rendered the attitude state yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
