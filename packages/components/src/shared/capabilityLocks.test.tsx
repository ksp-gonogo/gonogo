import {
  defineUplinkClient,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import { useCommand, useStream } from "@ksp-gonogo/sitrep-client";
import { UnlockKind } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { AugmentSlot, LockScope, Panel, Section } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RequiresGuard } from "./RequiresGuard";

const MISSION_CONTROL = {
  kind: UnlockKind.Facility,
  id: "MissionControl",
  name: "Mission Control",
  tier: 2,
};
const FLIGHT_CONTROL = {
  kind: UnlockKind.Tech,
  id: "flightControl",
  name: "Flight Control",
  scienceCost: 45,
};

/** A `notUnlocked` Fail, as a verdict naming what is missing would arrive. */
function locked(missing: object) {
  return {
    outcome: 1,
    errorCode: "notUnlocked",
    detail: "",
    missing: [missing],
  };
}

const PASS = { outcome: 0, detail: "" };

function PlanControls() {
  useCommand("vessel.maneuver.add");
  return <p>plan controls</p>;
}

function ExecutorRows() {
  useStream("executor.state");
  return <p>executor rows</p>;
}

describe("capability locks", () => {
  it("refuses the whole widget when its own body holds a locked command, and comes back when it unlocks", () => {
    const fixture = setupStreamFixture();
    function Planner() {
      useCommand("vessel.maneuver.add");
      return <Panel panelTitle="PLANNER">planner body</Panel>;
    }
    render(
      <fixture.Provider>
        <RequiresGuard title="Maneuver Planner" channels={[]}>
          <Planner />
        </RequiresGuard>
      </fixture.Provider>,
    );
    expect(screen.getByText("planner body")).toBeTruthy();

    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [
          { command: "vessel.maneuver.add", verdict: locked(MISSION_CONTROL) },
        ],
      });
    });
    expect(screen.getByText("Mission Control")).toBeTruthy();
    expect(screen.getByText("Needs Building level 2")).toBeTruthy();
    expect(screen.queryByText("planner body")).toBeNull();

    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [{ command: "vessel.maneuver.add", verdict: PASS }],
      });
    });
    expect(screen.getByText("planner body")).toBeTruthy();
    expect(screen.queryByText("Mission Control")).toBeNull();
  });

  it("refuses only the section whose content holds the locked capability", () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <RequiresGuard title="Maneuver Planner" channels={[]}>
          <Panel
            panelTitle="PLANNER"
            sections={[
              <Section key="nodes" title="Planned nodes">
                <p>node list</p>
              </Section>,
              <Section key="plan" title="New maneuver">
                <PlanControls />
              </Section>,
            ]}
          />
        </RequiresGuard>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [
          { command: "vessel.maneuver.add", verdict: locked(MISSION_CONTROL) },
        ],
      });
    });
    expect(screen.getByText("node list")).toBeTruthy();
    expect(screen.getByText("New maneuver")).toBeTruthy();
    expect(screen.getByText("Mission Control")).toBeTruthy();
    expect(screen.queryByText("plan controls")).toBeNull();
  });

  it("covers a namespace through a channel entry ending in a dot", () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <Section title="Executor">
          <ExecutorRows />
        </Section>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [],
        channels: [{ topic: "executor.", verdict: locked(FLIGHT_CONTROL) }],
      });
    });
    expect(screen.getByText("Missing tech: Flight Control")).toBeTruthy();
    expect(screen.getByText("45.0sci to research")).toBeTruthy();
  });

  it("keeps an Uplink augment's lock inside the augment, even when it reads in its own body", () => {
    const owner = defineUplinkClient({
      id: "lock-test",
      version: "0.0.0",
      name: "Lock test",
    });
    registerAugment({
      id: "lock-test:executor",
      augments: "maneuver-planner.sections",
      owner,
      label: "Burn executor",
      component: () => {
        useStream("executor.state");
        return <Section title="Burn executor">executor rows</Section>;
      },
    } as Parameters<typeof registerAugment>[0]);
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <RequiresGuard title="Host" channels={[]}>
          <Panel panelTitle="HOST">
            <p>host body</p>
            <AugmentSlot name="maneuver-planner.sections" props={{}} />
          </Panel>
        </RequiresGuard>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [],
        channels: [{ topic: "executor.", verdict: locked(FLIGHT_CONTROL) }],
      });
    });
    expect(screen.getByText("host body")).toBeTruthy();
    expect(screen.getByText("Burn executor")).toBeTruthy();
    expect(screen.getByText("Missing tech: Flight Control")).toBeTruthy();
    expect(screen.queryByText("executor rows")).toBeNull();
  });

  it("ignores a refusal that is not a missing unlock, which stays the control's own", () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <Section title="New maneuver">
          <PlanControls />
        </Section>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [
          {
            command: "vessel.maneuver.add",
            verdict: { outcome: 1, errorCode: "limitReached", detail: "" },
          },
        ],
      });
    });
    expect(screen.getByText("plan controls")).toBeTruthy();
  });

  it("locks the widget on a declared channel its body never reads", () => {
    // A connected host, or the guard draws its no-host refusal for a widget that declares channels.
    registerDataSource({
      id: "sitrep",
      name: "Sitrep Stream",
      status: "connected",
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      configSchema: () => [],
      getConfig: () => ({}),
      configure: () => {},
      onStatusChange: () => () => {},
    });
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <RequiresGuard title="Executor" channels={["executor.state"]}>
          <p>reads nothing yet</p>
        </RequiresGuard>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [],
        channels: [{ topic: "executor.", verdict: locked(FLIGHT_CONTROL) }],
      });
    });
    expect(screen.queryByText("reads nothing yet")).toBeNull();
    expect(screen.getByText("Missing tech: Flight Control")).toBeTruthy();
  });

  it("draws nothing for a locked scope whose fallback is null, and keeps the lock from its parent", () => {
    const fixture = setupStreamFixture();
    render(
      <fixture.Provider>
        <Section title="Host">
          <p>host rows</p>
          <LockScope fallback={null}>
            <ExecutorRows />
          </LockScope>
        </Section>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [],
        channels: [{ topic: "executor.", verdict: locked(FLIGHT_CONTROL) }],
      });
    });
    expect(screen.getByText("host rows")).toBeTruthy();
    expect(screen.queryByText("executor rows")).toBeNull();
    expect(screen.queryByText("Missing tech: Flight Control")).toBeNull();
  });

  it("draws the compact mark in a tiny tile, named by the whole sentence", () => {
    const fixture = setupStreamFixture();
    function Planner() {
      useCommand("vessel.maneuver.add");
      return <p>tiny figures</p>;
    }
    render(
      <fixture.Provider>
        <RequiresGuard
          title="Maneuver Planner"
          channels={[]}
          compact={{ title: "MANEUVER" }}
        >
          <Planner />
        </RequiresGuard>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("system.uplink.gates", {
        gates: [
          { command: "vessel.maneuver.add", verdict: locked(MISSION_CONTROL) },
        ],
      });
    });
    expect(screen.queryByText("tiny figures")).toBeNull();
    expect(
      screen.getByRole("status", {
        name: "Mission Control. Needs Building level 2",
      }),
    ).toBeTruthy();
  });
});
