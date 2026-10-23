import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { CatalogContact, Quality, Situation } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/** A descent the centre stopped hearing is shown as lost contact once the catalog says it is overdue, never as live and never as a crash. */

describe("LandingStatus when the centre loses a descending craft", () => {
  let stream: ReturnType<typeof setupStreamFixture>;
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    registerStockBodies();
    stream = setupStreamFixture({ pinnedUt: 100, suspendFrames: true });
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  function emitDescent() {
    stream.emit("trackingStation.bodies", {
      bodies: [
        {
          name: "Mun",
          index: 2,
          parentIndex: 1,
          radius: 200_000,
          gravParameter: 6.5138398e10,
          atmosphere: null,
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "lander",
      name: "Lander",
      vesselType: 0,
      situation: Situation.SubOrbital,
      parentBodyIndex: 2,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 2,
        sma: 250_000,
        ecc: 0.3,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 6.5138398e10,
      },
      { quality: Quality.Loaded },
    );
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 5_000,
      altitudeTerrain: 2_800,
      verticalSpeed: -42,
      surfaceSpeed: 50,
      orbitalSpeed: 50,
      atmDensity: 0,
    });
    stream.emit("vessel.surface", {
      biome: "Highlands",
      landedAt: null,
      heightFromTerrain: 2_800,
    });
    stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
  }

  function emitCatalog(contact: Record<string, unknown>) {
    stream.emit("trackingStation.catalog", {
      entries: [
        {
          vesselId: "lander",
          name: "Lander",
          vesselType: 0,
          situation: Situation.SubOrbital,
          ...contact,
        },
      ],
    });
  }

  async function renderWith(contact: Record<string, unknown>) {
    render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-lost" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent config={{}} id="land-lost" w={8} h={12} />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    await flushResizeObservers();
    act(() => {
      emitDescent();
      emitCatalog(contact);
    });
    await flushResizeObservers();
    await waitFor(() => expect(visibleText()).toContain("Mun"));
  }

  it("says nothing of lost contact while the craft is in contact", async () => {
    await renderWith({
      contact: CatalogContact.InContact,
      lastContactUt: 100,
    });
    expect(visibleText()).not.toMatch(/OVERDUE|PRESUMED LOST|NO CONTACT/);
  });

  it("says nothing of lost contact while a silent craft is not yet overdue", async () => {
    await renderWith({
      contact: CatalogContact.Silent,
      lastContactUt: 60,
      expectedReturnUt: 400,
      overdueAfterUt: 500,
    });
    expect(visibleText()).not.toMatch(/OVERDUE|PRESUMED LOST/);
  });

  it("reads overdue, with the time of the last contact, once a silent craft is past its overdue time", async () => {
    await renderWith({
      contact: CatalogContact.Silent,
      lastContactUt: 60,
      expectedReturnUt: 80,
      overdueAfterUt: 90,
    });
    await waitFor(() => expect(visibleText()).toContain("OVERDUE"));
    expect(visibleText()).toContain("NO CONTACT SINCE");
    expect(visibleText()).not.toMatch(/CRASHED|DESTROYED|PRESUMED LOST/);
  });

  it("reads presumed lost once the home centre has declared the craft lost", async () => {
    await renderWith({
      contact: CatalogContact.Lost,
      lastContactUt: 60,
      declaredLostUt: 95,
    });
    await waitFor(() => expect(visibleText()).toContain("PRESUMED LOST"));
    expect(visibleText()).toContain("NO CONTACT SINCE");
    expect(visibleText()).not.toMatch(/CRASHED|DESTROYED/);
  });
});
