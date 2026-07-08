import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import midCareer from "./__fixtures__/mid-career-mixed.json";
import { SpaceCenterStatusComponent } from "./index";

/**
 * SpaceCenterStatus's M3 career batch behavior-preservation golden dual-run
 * (mirrors `DistanceToTarget/dual-run.test.tsx`, M3 vessel-gap batch): the
 * SAME career state, rendered once off the legacy `DataSource` and once off
 * the stream, must produce byte-identical DOM at `delay=0`. `career.funds`
 * (78400) is the only migrated field — every other fixture key
 * (`kc.facilityLevels`/`partsAvailable`/`launchSite`/`padOccupied`/
 * `padVesselTitle`/`scene`) stays legacy on both legs.
 */
afterEach(() => {
  cleanup();
});

describe("SpaceCenterStatus — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same career state", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: SpaceCenterStatusComponent,
      fixture: midCareer,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.facilityLevels" },
        { key: "kc.partsAvailable" },
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
        { key: "kc.scene" },
      ],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-dual" }}>
          <SpaceCenterStatusComponent id="scs-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    // Emit the STREAM value first and let its frame settle before the
    // legacy kc.* facility data arrives. `career.status` lands one
    // microtask late (TelemetryProvider's `scheduleFrame`, no rAF in
    // jsdom) — if the facility data (which gates whether the per-facility
    // UpgradeButton even mounts) arrived first instead, the button would
    // mount once with `careerFunds` still `undefined` (canAfford defaults
    // true) and then get its `disabled` attribute APPENDED on the
    // following update, landing after `title` in DOM attribute order
    // instead of before it like a legacy fresh mount (both JSX branches
    // declare `disabled` before `title`) — a spurious non-semantic
    // attribute-order diff, not a real behavior difference. Settling funds
    // first means the button mounts fresh, once, with both signals known,
    // exactly like the legacy leg's single-batched-emit fresh mount.
    act(() => {
      streamFixture.emit("career.status", {
        economy: {
          funds: midCareer["career.funds"],
          reputation: null,
          science: null,
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    await waitFor(() => {
      if (!container.textContent?.includes("78,400f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    act(() => {
      legacyAux.source.emit(
        "kc.facilityLevels",
        midCareer["kc.facilityLevels"],
      );
      legacyAux.source.emit(
        "kc.partsAvailable",
        midCareer["kc.partsAvailable"],
      );
      legacyAux.source.emit("kc.launchSite", midCareer["kc.launchSite"]);
      legacyAux.source.emit("kc.padOccupied", midCareer["kc.padOccupied"]);
      legacyAux.source.emit(
        "kc.padVesselTitle",
        midCareer["kc.padVesselTitle"],
      );
      legacyAux.source.emit("kc.scene", midCareer["kc.scene"]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("On pad:")) {
        throw new Error("stream leg has not rendered facility data yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
