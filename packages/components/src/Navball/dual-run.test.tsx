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
 * (`n.heading`/`n.pitch`/`n.roll` -> `vessel.attitude.*`; `f.sasMode`/
 * `f.sasEnabled` -> `vessel.control.sasMode`/`sas`; `v.rcsValue` ->
 * `vessel.control.rcs`; `f.throttle` -> `vessel.control.throttle`) or a
 * declared GAP this widget always reads regardless of config
 * (`f.precisionControl`, `v.isControllable`) — so the stream leg needs a
 * legacy AUX source for exactly those two gapped keys, registered alongside
 * the `TelemetryProvider`, proving the shim's MIXED-source coexistence
 * (some keys stream, others legacy, same render) exactly like the pilot.
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
      keys: [{ key: "f.precisionControl" }, { key: "v.isControllable" }],
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
      legacyAux.source.emit(
        "f.precisionControl",
        northLevel["f.precisionControl"],
      );
      legacyAux.source.emit("v.isControllable", northLevel["v.isControllable"]);
      streamFixture.emit("vessel.attitude", {
        heading: northLevel["n.heading"],
        pitch: northLevel["n.pitch"],
        roll: northLevel["n.roll"],
      });
      streamFixture.emit("vessel.control", {
        sas: northLevel["f.sasEnabled"],
        sasMode: northLevel["f.sasMode"],
        rcs: northLevel["v.rcsValue"],
        throttle: northLevel["f.throttle"],
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("StabilityAssist")) {
        throw new Error("stream leg has not rendered the attitude state yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
