import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import flybyAhead from "./__fixtures__/kerbin-mun-flyby-ahead.json";
import { SystemViewComponent } from "./index";

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const MUN_SOI = 2_429_559;

/*
 * A Hohmann arrival at the Mun: 278 m/s of excess speed, which fixes the
 * semi-major axis at -mu/v², and a periapsis 250 km from the Mun's centre.
 */
const EXCESS_SPEED = 278;
const PERIAPSIS_RADIUS = 250_000;
const FLYBY_SMA = -MUN_MU / EXCESS_SPEED ** 2;
const FLYBY_ECC = 1 + PERIAPSIS_RADIUS / Math.abs(FLYBY_SMA);

const SYSTEM = {
  bodies: [
    {
      index: KERBOL_INDEX,
      name: "Kerbol",
      parentIndex: null,
      radius: 261_600_000,
      gravParameter: KERBOL_MU,
      orbit: null,
    },
    {
      index: KERBIN_INDEX,
      name: "Kerbin",
      parentIndex: KERBOL_INDEX,
      radius: 600_000,
      gravParameter: KERBIN_MU,
      sphereOfInfluence: 84_159_286,
      isHome: true,
      orbit: {
        sma: 13_599_840_256,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 1,
        epoch: 0,
      },
    },
    {
      index: MUN_INDEX,
      name: "Mun",
      parentIndex: KERBIN_INDEX,
      radius: 200_000,
      gravParameter: MUN_MU,
      sphereOfInfluence: MUN_SOI,
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
  ],
};

function mount(frame: string, meanAnomalyAtEpoch = -1.06) {
  const fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "system-view", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <SystemViewComponent config={{ frame } as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", SYSTEM);
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: MUN_INDEX,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: MUN_INDEX,
      sma: FLYBY_SMA,
      ecc: FLYBY_ECC,
      inc: 0,
      lan: 0,
      argPe: 333,
      meanAnomalyAtEpoch,
      epoch: 0,
      mu: MUN_MU,
      horizon: { kind: 1, trajectoryKind: 1 },
      encounter: { transitionType: 3, transitionUt: 8978, bodyIndex: 1 },
    });
  });
  return { fixture, view };
}

interface Point {
  x: number;
  y: number;
}

async function drawn(
  view: { container: HTMLElement },
  selector: string,
): Promise<Element> {
  return waitFor(() => {
    const found = view.container.querySelector(selector);
    if (found === null) throw new Error(`${selector} is not drawn`);
    return found;
  });
}

function centreOf(circle: Element): Point {
  return {
    x: Number(circle.getAttribute("cx")),
    y: Number(circle.getAttribute("cy")),
  };
}

/** The vertices of a polyline path, in the order drawn. */
function verticesOf(path: Element): Point[] {
  const d = path.getAttribute("d") ?? "";
  return Array.from(d.matchAll(/[ML]\s*(-?[\d.e+-]+),(-?[\d.e+-]+)/g)).map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
  );
}

/** Where the craft's marker is drawn: its halo is the one circle placed by its own centre. */
function craftAt(marker: Element): Point {
  const halo = marker.querySelector("circle[cx]");
  if (halo === null) throw new Error("the craft marker has no placed circle");
  return centreOf(halo);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("SystemView draws a craft on an open orbit", () => {
  it("draws the arc of a Mun flyby inside the Mun's sphere of influence, in the Mun's own frame", async () => {
    const { view } = mount("Mun");
    const mun = centreOf(await drawn(view, 'circle[data-body="Mun"]'));
    const path = await drawn(view, "[data-vessel-trajectory]");
    const d = path.getAttribute("d") ?? "";
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d.trimEnd().endsWith("Z")).toBe(false);

    const vertices = verticesOf(path);
    expect(vertices.length).toBeGreaterThan(8);
    const radii = vertices.map((v) => distance(v, mun));
    const edge = radii[0];
    const closest = Math.min(...radii);
    // Both ends stand on the sphere of influence, and nothing is drawn beyond it.
    expect(radii[radii.length - 1]).toBeCloseTo(edge, 3);
    expect(Math.max(...radii)).toBeCloseTo(edge, 3);
    // The arc passes the Mun at the periapsis the elements state.
    expect(closest / edge).toBeCloseTo(PERIAPSIS_RADIUS / MUN_SOI, 2);
    await act(async () => {});
  });

  it("puts the craft on that arc, inbound and short of periapsis", async () => {
    const { view } = mount("Mun");
    const mun = centreOf(await drawn(view, 'circle[data-body="Mun"]'));
    const path = await drawn(view, "[data-vessel-trajectory]");
    const marker = await drawn(view, "[data-vessel-position]");
    const vertices = verticesOf(path);
    const edge = distance(vertices[0], mun);
    const craft = craftAt(marker);
    const offArc = Math.min(...vertices.map((v) => distance(craft, v)));
    // Within the spacing between two samples of the arc.
    expect(offArc).toBeLessThan(edge / 16);
    const craftRadius = distance(craft, mun);
    expect(craftRadius).toBeGreaterThan(edge * 0.3);
    expect(craftRadius).toBeLessThan(edge);
    // Inbound: nearer the arc's first end, where it enters, than its last.
    expect(distance(craft, vertices[0])).toBeLessThan(
      distance(craft, vertices[vertices.length - 1]),
    );
    await act(async () => {});
  });

  it("draws the craft at the Mun when the frame is Kerbin", async () => {
    const { view } = mount("Kerbin");
    const mun = centreOf(await drawn(view, 'circle[data-body="Mun"]'));
    const marker = await drawn(view, "[data-vessel-position]");
    const path = await drawn(view, "[data-vessel-trajectory]");
    expect(path.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/);
    const vertices = verticesOf(path);
    // The arc's ends are the Mun's sphere of influence, drawn about the Mun.
    const soi = distance(vertices[0], mun);
    expect(distance(vertices[vertices.length - 1], mun)).toBeCloseTo(soi, 3);
    const craftRadius = distance(craftAt(marker), mun);
    expect(craftRadius).toBeGreaterThan(0);
    expect(craftRadius).toBeLessThan(soi);
    await act(async () => {});
  });
});

describe("SystemView draws a target on an open orbit", () => {
  const KERBIN_SOI = 84_159_286;
  const TARGET_PERIAPSIS = 2_000_000;
  const TARGET_SMA = -6_000_000;
  const TARGET_ECC = 1 + TARGET_PERIAPSIS / Math.abs(TARGET_SMA);

  it("draws the target's open arc about Kerbin, out to Kerbin's sphere of influence", async () => {
    const fixture: StreamFixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider
          value={{ componentId: "system-view", contributionSlots: [] }}
        >
          <ContributionsProvider>
            <SystemViewComponent
              config={{ frame: "Kerbin" } as never}
              id="sv"
            />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    const analytic = { kind: 1, trajectoryKind: 1 };
    act(() => {
      fixture.emit("system.bodies", SYSTEM);
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Active Craft",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: KERBIN_INDEX,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: KERBIN_INDEX,
        sma: 700_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: KERBIN_MU,
        horizon: analytic,
      });
      fixture.emit("vessel.target", {
        name: "Departing Probe",
        kind: 0,
        vesselId: "v-probe",
        orbit: {
          referenceBodyIndex: KERBIN_INDEX,
          sma: TARGET_SMA,
          ecc: TARGET_ECC,
          inc: 0,
          lan: 0,
          argPe: 40,
          meanAnomalyAtEpoch: 0.3,
          epoch: 0,
          mu: KERBIN_MU,
          patches: [],
          horizon: analytic,
        },
      });
    });
    const kerbin = centreOf(await drawn(view, 'circle[data-body="Kerbin"]'));
    const path = await drawn(view, "[data-target-trajectory]");
    const d = path.getAttribute("d") ?? "";
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d.trimEnd().endsWith("Z")).toBe(false);
    const radii = verticesOf(path).map((v) => distance(v, kerbin));
    expect(radii.length).toBeGreaterThan(8);
    const edge = radii[0];
    expect(radii[radii.length - 1]).toBeCloseTo(edge, 2);
    expect(Math.min(...radii) / edge).toBeCloseTo(
      TARGET_PERIAPSIS / KERBIN_SOI,
      3,
    );
    await act(async () => {});
  });
});

describe("SystemView draws a flyby that is still ahead of the craft", () => {
  function mountFlybyAhead() {
    const fixture: StreamFixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider
          value={{ componentId: "system-view", contributionSlots: [] }}
        >
          <ContributionsProvider>
            <SystemViewComponent config={{ frame: "auto" } as never} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      for (const emit of flybyAhead._stream.emits) {
        fixture.emit(emit.channel as never, emit.value as never);
      }
    });
    return view;
  }

  it("draws the open leg about the Mun, joined to the transfer before it and the orbit after it", async () => {
    const view = mountFlybyAhead();
    const leg = await drawn(view, '[data-patch-body="Mun"]');
    const d = leg.getAttribute("d") ?? "";
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d.trimEnd().endsWith("Z")).toBe(false);
    const legVertices = verticesOf(leg);
    expect(legVertices.length).toBeGreaterThan(8);

    const kerbinArcs = Array.from(
      view.container.querySelectorAll('[data-patch-body="Kerbin"]'),
    ).map(verticesOf);
    expect(kerbinArcs).toHaveLength(2);
    const [transfer, after] = kerbinArcs;
    // The craft's state is continuous across a sphere of influence, so each leg starts where the one before it stops.
    expect(
      distance(transfer[transfer.length - 1], legVertices[0]),
    ).toBeLessThan(1.5);
    expect(
      distance(legVertices[legVertices.length - 1], after[0]),
    ).toBeLessThan(1.5);
    await act(async () => {});
  });

  it("marks the encounter where the leg begins and the escape where it ends", async () => {
    const view = mountFlybyAhead();
    await drawn(view, '[data-patch-body="Mun"]');
    const labels = Array.from(
      view.container.querySelectorAll("[data-encounter-subject] text"),
    ).map((t) => t.textContent);
    expect(labels).toContain("→ Mun");
    expect(labels).toContain("escape Kerbin");
    await act(async () => {});
  });
});
