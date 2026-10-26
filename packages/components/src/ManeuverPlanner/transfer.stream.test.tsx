import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { ManeuverFrame, Quality, TransitionType } from "@ksp-gonogo/sitrep-sdk";
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

const MUN_ORBIT = { referenceBodyIndex: 2, sma: 230_000, mu: 6.5138398e10 };

function mount(orbit: Record<string, number> = {}) {
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
      ...orbit,
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

describe("Maneuver Planner adding a node", () => {
  it("holds the control and says so until the plan lists the node, so a second press cannot plan it twice", async () => {
    const { fixture, commandHandler } = mount();
    const user = await pickBody("Mun");
    await waitFor(() => expect(previewValue("Mun Pe")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Add node" }));
    await waitFor(() => expect(commandHandler).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Adding..." })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Adding maneuver node")).toBeInTheDocument();
    emitNode(fixture, []);
    expect(
      await screen.findByRole("button", { name: "Add node" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(commandHandler).toHaveBeenCalledTimes(1);
  });
});

describe("Maneuver Planner burn at an apsis below the surface", () => {
  const MUN_MU = 6.5138398e10;
  const SMA = 189_150;
  const ECC = 0.21597;
  const MEAN_MOTION = Math.sqrt(MUN_MU / SMA ** 3);

  /** A coasting craft on the orbit at mean anomaly `meanAnomaly`, 30 km above the Mun at its apoapsis. */
  function mountAt(meanAnomaly: number) {
    const { fixture } = mount();
    let eccentric = meanAnomaly;
    for (let i = 0; i < 50; i++) {
      eccentric -=
        (eccentric - ECC * Math.sin(eccentric) - meanAnomaly) /
        (1 - ECC * Math.cos(eccentric));
    }
    const radius = SMA * (1 - ECC * Math.cos(eccentric));
    const toPe =
      meanAnomaly < 0
        ? -meanAnomaly / MEAN_MOTION
        : (2 * Math.PI - meanAnomaly) / MEAN_MOTION;
    const toAp =
      meanAnomaly < Math.PI && meanAnomaly > 0
        ? (Math.PI - meanAnomaly) / MEAN_MOTION
        : toPe + Math.PI / MEAN_MOTION;
    act(() => {
      fixture.emit("vessel.flight", {
        orbitalSpeed: Math.sqrt(MUN_MU * (2 / radius - 1 / SMA)),
      });
      fixture.emit("vessel.propulsion", {
        totalMass: 54,
        dryMass: 20,
        currentThrust: 0,
        availableThrust: 650,
      });
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 2,
          sma: SMA,
          ecc: ECC,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: meanAnomaly,
          timeToPe: toPe,
          timeToAp: toAp,
          epoch: NOW,
          mu: MUN_MU,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        { quality: Quality.Loaded, validAt: NOW, deliveredAt: NOW },
      );
    });
  }

  it("says the trajectory meets the surface where the apoapsis comes after the descent", async () => {
    mountAt(-2.2);
    expect(await screen.findByText("Meets the surface")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add node" })).toBeNull();
  });

  it("plans the circularise burn on the way up, where the apoapsis comes first", async () => {
    mountAt(2.2);
    expect(
      await screen.findByRole("button", { name: "Add node" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Meets the surface")).toBeNull();
  });
});

describe("Maneuver Planner return to the parent body", () => {
  it("offers the body the Mun orbits beside the Mun's sibling", async () => {
    mount(MUN_ORBIT);
    await pickBody("Kerbin");
    const names = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    );
    expect(names).toEqual(expect.arrayContaining(["Kerbin", "Minmus"]));
    expect(names).not.toContain("Kerbol");
    expect(names).not.toContain("Mun");
  });

  it("plans the ejection to Kerbin with the periapsis asked for", async () => {
    mount(MUN_ORBIT);
    await pickBody("Kerbin");
    await waitFor(() => expect(previewValue("Kerbin Pe")).not.toBeNull());
    const metres = Number.parseFloat(
      (previewValue("ΔV") ?? "").replace(/[^\d.]/g, ""),
    );
    expect(metres).toBeGreaterThan(250);
    expect(metres).toBeLessThan(350);
    expect(previewValue("Burn in")).not.toBeNull();
    expect(previewValue("Flight")).not.toBeNull();
  });

  it("offers no star as a body to return to from Kerbin", async () => {
    mount();
    await pickBody("Mun");
    const names = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    );
    expect(names).not.toContain("Kerbol");
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

  it("reads the escape into the parent body as reaching it", async () => {
    const fixture = mount(MUN_ORBIT).fixture;
    await pickBody("Kerbin");
    emitNode(fixture, [
      patch({
        referenceBody: "Kerbin",
        patchStartTransition: TransitionType.Escape,
        peA: 40_000,
      }),
    ]);
    expect(await screen.findByText(/encounter, Pe/)).toBeInTheDocument();
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
