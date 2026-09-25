import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import { RosterCommsControlSource } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetRosterComponent } from "./index";

/**
 * What a craft's signal panel says once its `fleet.<guid>.*` topics stop
 * arriving. The Link term is a present-tense verdict, so a held one has to say
 * it is the last known, the same way the Delay row already does.
 */

const CRAFT = {
  vessels: [
    {
      vesselId: "v-probe",
      name: "Explorer",
      vesselType: 3,
      situation: 3,
      bodyIndex: 1,
      crewCount: 0,
      crewCapacity: 0,
      commsControlSource: RosterCommsControlSource.Full,
    },
  ],
};

afterEach(() => {
  clearAugments();
});

async function mountLinked() {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "system.vessels",
      "system.bodies",
      "commandCentre.roster",
      "fleet.",
      "silence.",
    ],
    pinnedUt: 2_000,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fleet-stale" }}>
        <FleetRosterComponent config={{}} id="fleet-stale" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.vessels", CRAFT);
  });
  const trigger = await screen.findByRole("button", {
    name: /Explorer signal/i,
  });
  act(() => {
    fixture.emit("fleet.v-probe.contact", { connected: true });
    fixture.emit("fleet.v-probe.delay", {
      oneWaySeconds: 4.5,
      connected: true,
    });
  });
  act(() => {
    trigger.click();
  });
  const panel = document.getElementById(
    trigger.getAttribute("aria-controls") ?? "",
  ) as HTMLElement;
  return { fixture, panel };
}

describe("FleetRoster signal panel when the fleet topics stop arriving", () => {
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
