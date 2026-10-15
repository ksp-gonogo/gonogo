import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import {
  CatalogContact,
  RosterCommsControlSource,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VesselCatalogComponent } from "./index";

/** A held Link term in the signal panel says it is the last known, as the Delay row does. */

const CRAFT = {
  entries: [
    {
      vesselId: "v-probe",
      name: "Explorer",
      vesselType: 3,
      situation: 3,
      bodyIndex: 1,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
      contact: CatalogContact.InContact,
    },
  ],
};

/**
 * Cleared before, not after: RTL's own afterEach cleanup runs after this
 * file's, so an afterEach clear would land while the tree is still mounted
 * and re-render a useSyncExternalStore subscriber outside act.
 */
beforeEach(() => {
  clearAugments();
});

async function mountLinked() {
  const fixture = setupStreamFixture({
    pinnedUt: 2_000,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fleet-stale" }}>
        <VesselCatalogComponent config={{}} id="fleet-stale" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.catalog", CRAFT);
  });
  const trigger = await screen.findByRole("button", {
    name: /Explorer signal/i,
  });
  act(() => {
    fixture.emit("trackingStation.vessel.v-probe.link", {
      oneWaySeconds: 4.5,
      connected: true,
    });
  });
  act(() => {
    trigger.focus();
  });
  const panel = document.getElementById(
    trigger.getAttribute("aria-describedby") ?? "",
  ) as HTMLElement;
  return { fixture, panel };
}

describe("VesselCatalog signal panel when the fleet topics stop arriving", () => {
  it("states the link as current while it is arriving", async () => {
    const { panel } = await mountLinked();
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));
    expect(visibleText(panel)).not.toContain("last known");
    await act(async () => {});
  });

  it("holds the link and the delay and marks both as the last known", async () => {
    const { fixture, panel } = await mountLinked();
    await waitFor(() => expect(visibleText(panel)).toContain("connected"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(visibleText(panel)).toContain("connected (last known)"),
    );
    expect(visibleText(panel)).toContain("Delay (last known)");
    await act(async () => {});
  });
});

describe("VesselCatalog header badge", () => {
  function mountEmpty() {
    const fixture = setupStreamFixture({
      pinnedUt: 2_000,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "fleet-badge" }}>
          <VesselCatalogComponent config={{}} id="fleet-badge" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, container };
  }

  it("does not say there are no vessels before the roster has arrived", () => {
    const { container } = mountEmpty();
    expect(visibleText(container)).not.toContain("No Vessels");
  });

  it("marks the rollup held once the roster stops arriving", async () => {
    const { fixture, container } = mountEmpty();
    act(() => {
      fixture.emit("trackingStation.catalog", CRAFT);
    });
    await waitFor(() => expect(visibleText(container)).toContain("All Linked"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // A held badge shows its grade's word in place of the verdict it can no longer vouch for.
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("All Linked"),
    );
  });
});
