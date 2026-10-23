import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { ManeuverFrame, TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";
import { wideTileForTests } from "./wideTile";

wideTileForTests();

afterEach(() => {
  clearActionHandlers();
});

const NODE_ID = "5e1e5cf4-52f6-4f5d-8e32-0d5a7a5d2a11";
const NOW = 1_000_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

const KERBIN_SYSTEM = [
  {
    index: 0,
    name: "Kerbol",
    parentIndex: null,
    radius: 261_600_000,
    gravParameter: 1.1723328e18,
    sphereOfInfluence: null,
    orbit: null,
  },
  {
    index: 1,
    name: "Kerbin",
    parentIndex: 0,
    radius: 600_000,
    gravParameter: 3.5316e12,
    sphereOfInfluence: 84_159_286,
    orbit: {
      sma: 13_599_840_256,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 3.14,
      epoch: 0,
    },
  },
  {
    index: 2,
    name: "Mun",
    parentIndex: 1,
    radius: 200_000,
    gravParameter: 6.5138398e10,
    sphereOfInfluence: 2_429_559,
    orbit: {
      sma: 12_000_000,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 1.7,
      epoch: 0,
    },
  },
  {
    index: 3,
    name: "Minmus",
    parentIndex: 1,
    radius: 60_000,
    gravParameter: 1.7658e9,
    sphereOfInfluence: 2_247_428,
    orbit: {
      sma: 47_000_000,
      ecc: 0,
      inc: 6,
      lan: 78,
      argPe: 38,
      meanAnomalyAtEpoch: 0.9,
      epoch: 0,
    },
  },
  {
    index: 4,
    name: "Duna",
    parentIndex: 0,
    radius: 320_000,
    gravParameter: 3.0136321e11,
    sphereOfInfluence: 47_921_949,
    orbit: {
      sma: 20_726_155_264,
      ecc: 0.051,
      inc: 0.06,
      lan: 135.5,
      argPe: 0,
      meanAnomalyAtEpoch: 3.14,
      epoch: 0,
    },
  },
];

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: NOW, suspendFrames: true });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-transfer" }}>
        <ManeuverPlannerComponent id="mnv-transfer" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", { bodies: KERBIN_SYSTEM });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0.4,
      epoch: NOW,
      mu: 3.5316e12,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    });
  });
  return { fixture, commandHandler };
}

async function pickBody(name: string) {
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Maneuver preset" }),
    "transfer-to-body",
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Transfer body" }),
    name,
  );
  return user;
}

function previewValue(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}

function emitNode(
  fixture: ReturnType<typeof setupStreamFixture>,
  patches: unknown[],
  prograde = 837,
) {
  act(() => {
    fixture.emit("vessel.maneuver", {
      nodes: [
        {
          id: NODE_ID,
          ut: NOW + 800,
          dvRadial: 0,
          dvNormal: 0,
          dvPrograde: prograde,
          dvTotal: prograde,
          frame: ManeuverFrame.RadialNormalPrograde,
          patches,
        },
      ],
    });
  });
}

const patch = (over: Record<string, unknown>) => ({
  sma: 700_000,
  ecc: 0.7,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: NOW,
  period: 1000,
  startUt: NOW,
  endUt: NOW + 1000,
  patchStartTransition: TransitionType.Maneuver,
  patchEndTransition: TransitionType.Final,
  peA: 100_000,
  apA: 200_000,
  semiLatusRectum: 1,
  semiMinorAxis: 1,
  referenceBody: "Kerbin",
  closestEncounterBody: null,
  ...over,
});

describe("Maneuver Planner transfer to a body", () => {
  it("offers the moons of the craft's body and the other bodies of its parent", async () => {
    mount();
    await pickBody("Mun");
    const options = await screen.findAllByRole("option");
    const names = options.map((o) => o.textContent);
    expect(names).toEqual(expect.arrayContaining(["Mun", "Minmus", "Duna"]));
    expect(names).not.toContain("Kerbin (self)");
  });

  it("plans a Mun transfer of about 837 m/s with a periapsis at the Mun", async () => {
    mount();
    await pickBody("Mun");
    await waitFor(() => expect(previewValue("Mun Pe")).not.toBeNull());
    const dv = previewValue("ΔV") ?? "";
    const metres = Number.parseFloat(dv.replace(/[^\d.]/g, ""));
    expect(metres).toBeGreaterThan(825);
    expect(metres).toBeLessThan(850);
    expect(previewValue("Burn in")).not.toBeNull();
    expect(previewValue("Flight")).not.toBeNull();
  });

  it("plans a Duna transfer, whose ejection carries a normal component the readout shows", async () => {
    mount();
    await pickBody("Duna");
    await waitFor(() => expect(previewValue("Duna Pe")).not.toBeNull());
    const dv = Number.parseFloat(
      (previewValue("ΔV") ?? "").replace(/[^\d.]/g, ""),
    );
    // The Hohmann ejection from 100 km is about 1,060 m/s.
    expect(dv).toBeGreaterThan(1000);
    expect(dv).toBeLessThan(1130);
    expect(previewValue("Normal")).not.toBeNull();
  });

  it("aims for the periapsis typed in the Periapsis field", async () => {
    mount();
    const user = await pickBody("Mun");
    await waitFor(() => expect(previewValue("Mun Pe")).not.toBeNull());
    const field = screen.getByLabelText("Periapsis");
    await user.clear(field);
    await user.type(field, "300");
    await user.tab();
    await waitFor(() => {
      const km = Number.parseFloat(
        (previewValue("Mun Pe") ?? "").replace(/[^\d.]/g, ""),
      );
      expect(km).toBeGreaterThan(250);
      expect(km).toBeLessThan(350);
    });
  });

  it("sends the planned burn as a node", async () => {
    const { commandHandler } = mount();
    const user = await pickBody("Mun");
    await waitFor(() => expect(previewValue("Mun Pe")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Add node" }));
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.maneuver.add",
        expect.objectContaining({
          prograde: expect.toSatisfy((n: number) => n > 800),
          normal: expect.any(Number),
          radialOut: expect.any(Number),
          ut: expect.toSatisfy((n: number) => n > NOW),
        }),
      ),
    );
  });
});

describe("Maneuver Planner encounter check", () => {
  it("reads a node whose patches have not arrived as pending, never as no encounter", async () => {
    const { fixture } = mount();
    await pickBody("Mun");
    emitNode(fixture, []);
    await waitFor(() => expect(previewValue("Mun encounter")).toBe("pending"));
    expect(screen.queryByRole("button", { name: /Nudge/ })).toBeNull();
  });

  it("shows the target and its periapsis once the game's patches enter its sphere of influence", async () => {
    const { fixture } = mount();
    await pickBody("Mun");
    emitNode(fixture, [
      patch({ patchEndTransition: TransitionType.Encounter }),
      patch({
        referenceBody: "Mun",
        patchStartTransition: TransitionType.Encounter,
        peA: 181_000,
      }),
    ]);
    await waitFor(() => expect(previewValue("Mun encounter")).toContain("Pe"));
    expect(previewValue("Mun encounter")).toContain("181");
  });

  it("says none, and offers a nudge, when the patches never reach the target", async () => {
    const { fixture, commandHandler } = mount();
    const user = await pickBody("Mun");
    emitNode(fixture, [patch({})]);
    await waitFor(() => expect(previewValue("Mun encounter")).toBe("none"));
    await user.click(screen.getByRole("button", { name: /Nudge \+/ }));
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.maneuver.update",
        expect.objectContaining({ nodeId: NODE_ID, prograde: 838 }),
      ),
    );
  });
});
