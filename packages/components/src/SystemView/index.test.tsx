import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

// `useContributions` needs both contexts mounted, as the app's `WidgetContributions` wrapper provides; without them it silently returns empty.
const CONTRIBUTIONS_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.vessel-status"] as const,
};

function WithContributions({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider value={CONTRIBUTIONS_META}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

// Kerbin's GM: makes the client-side period / true-anomaly derivation land on real numbers so the predicted arc actually renders.
const KERBIN_MU = 3.5316e12;

// A Kerbin parking orbit that encounters the Mun (body index 1); `epoch` equals the pinned view-UT so mean anomaly reads cleanly.
function encounterOrbit() {
  return {
    referenceBodyIndex: 0,
    sma: 8_000_000,
    ecc: 0.4,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 100,
    mu: KERBIN_MU,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
    encounter: { transitionType: 2, transitionUt: 600, bodyIndex: 1 },
  };
}

// Kerbin as frame root (orbit null) with its GM, so children get a parent mu, plus Mun and Minmus with full orbits and almanac fields.
function kerbinSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        mass: 5.2915158e22,
        surfaceGravity: 1,
        sphereOfInfluence: 84_159_286,
        rotationPeriod: 21_549.425,
        hasOcean: true,
        atmosphere: {
          depth: 70_000,
          hasOxygen: true,
          seaLevelPressure: 101.325,
        },
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        rotationPeriod: 138_984.38,
        tidallyLocked: true,
        hasOcean: false,
        atmosphere: null,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
      {
        index: 2,
        name: "Minmus",
        parentIndex: 0,
        radius: 60_000,
        gravParameter: 1.7658e9,
        hasOcean: false,
        atmosphere: null,
        orbit: {
          sma: 47_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
    ],
  };
}

describe("SystemViewComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
  });

  function primeStream(orbit?: unknown) {
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      if (orbit !== undefined) fixture.emit("vessel.orbit", orbit);
    });
  }

  /** What each contact state may announce: a running countdown must not sit in a live region, overdue is polite, lost is assertive. */
  describe("contact state", () => {
    const SILENT = {
      state: "Silent",
      silenceSinceUt: 50,
      deadlineUt: 900,
      deadlineBasis: "predicted-reacquisition",
      predictedReacquisitionUt: 400,
    };

    async function renderWithContact(silence: Record<string, unknown>) {
      render(
        <fixture.Provider>
          <WithContributions>
            <SystemViewComponent config={{}} id="sv" />
          </WithContributions>
        </fixture.Provider>,
      );
      primeStream();
      // The transport is subscription-gated, and the silence.<guid>.state subscription exists only once identity has arrived.
      await screen.findAllByText(/Kerbin/i);
      act(() => {
        fixture.emit("silence.v.state", silence);
      });
    }

    it("counts down to a predicted reacquisition without announcing it", async () => {
      await renderWithContact(SILENT);

      // pinned UT 100, predicted 400 => 5 minutes out
      const caption = await screen.findByText(/reacquire expected/i);
      expect(caption).toBeInTheDocument();
      // A per-tick clock inside a live region would be read aloud forever.
      expect(caption.closest("[role='status']")).toBeNull();
      expect(caption.closest("[role='alert']")).toBeNull();
    });

    it("announces overdue politely, and does not call it lost", async () => {
      await renderWithContact({ ...SILENT, predictedReacquisitionUt: 60 });

      const caption = await screen.findByText(/overdue by/i);
      expect(caption.closest("[role='status']")).not.toBeNull();
      expect(screen.queryByText(/officially lost/i)).toBeNull();
    });

    it("announces an official loss assertively", async () => {
      await renderWithContact({ ...SILENT, state: "Lost" });

      const caption = await screen.findByText(/officially lost/i);
      expect(caption.closest("[role='alert']")).not.toBeNull();
    });

    it("shows no countdown for a silence geometry cannot explain", async () => {
      await renderWithContact({
        ...SILENT,
        deadlineBasis: "no-occultation",
        predictedReacquisitionUt: null,
      });

      expect(await screen.findByText(/no contact/i)).toBeInTheDocument();
      expect(screen.queryByText(/reacquire expected/i)).toBeNull();
      expect(screen.queryByText(/overdue/i)).toBeNull();
    });
  });

  it("waits for body data before rendering anything", () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{}} id="sv" />
      </fixture.Provider>,
    );
    expect(screen.getByText(/Waiting for body data/i)).toBeInTheDocument();
  });

  it("renders the almanac panel for the vessel's body when nothing is hovered", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{}} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    // "Kerbin" in both the SVG parent label and the almanac title confirms the panel landed on the vessel's body.
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("renders almanac fields when they're available", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    await waitFor(() => expect(screen.getByText("Radius")).toBeInTheDocument());

    // Assert the values, not just the labels, so the SI ladders are covered.
    await waitFor(() => expect(visibleText(container)).toContain("600.0 km"));
    // Kerbin's mass, derived from mu. 5.29e22 kg is 5.29e25 g, so Yg, not Zg.
    expect(visibleText(container)).toMatch(/52\.\d+ Yg/);
  });

  it("renders the child bodies of the frame in the diagram", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    // Mun + Minmus are Kerbin's children (parentIndex 0), drawn in the diagram.
    await waitFor(() =>
      expect(screen.getAllByText("Minmus").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Mun").length).toBeGreaterThan(0);
  });

  it("client-propagates the current orbit into a predicted arc from vessel.orbit + view-UT", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream(encounterOrbit());
    // The single client-reconstructed conic renders as one predicted arc; the post-encounter conic is not on the wire.
    await waitFor(() =>
      expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(
        1,
      ),
    );
  });

  it("renders without crashing on a hyperbolic (escape) orbit", async () => {
    // ecc >= 1 makes the Kepler solver throw, which the derivation must degrade to null scalars rather than crash the widget.
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream({
      referenceBodyIndex: 0,
      sma: -8_000_000, // negative sma: a hyperbolic conic
      ecc: 1.3,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 100,
      mu: KERBIN_MU,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      encounter: { transitionType: 3, transitionUt: 600, bodyIndex: 1 },
    });
    // The widget rendered, and the escape surfaces from the raw `vessel.orbit.encounter` scalar.
    await waitFor(() =>
      expect(screen.getByText(/next escape:\s*Mun/i)).toBeInTheDocument(),
    );
  });

  it("surfaces the next encounter body in the subtitle from vessel.orbit.encounter", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream(encounterOrbit());
    await waitFor(() =>
      expect(screen.getByText(/next encounter:\s*Mun/i)).toBeInTheDocument(),
    );
  });

  // The vessel marker must never fabricate a position: no `vessel.orbit` sample, or a non-numeric `sma`, draws nothing rather than a dot at the origin.
  it("draws no vessel marker before vessel.orbit has ever been emitted", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    // primeStream() with no orbit arg never emits vessel.orbit at all.
    primeStream();
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
    expect(
      container.querySelectorAll('circle[fill="var(--color-accent-fg)"]'),
    ).toHaveLength(0);
  });

  it("draws exactly one vessel marker, at a real (non-origin) position, once vessel.orbit lands", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream({
      referenceBodyIndex: 0,
      sma: 8_000_000,
      ecc: 0.4,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 100,
      mu: KERBIN_MU,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    });
    await waitFor(() => {
      const dots = container.querySelectorAll(
        'circle[fill="var(--color-accent-fg)"]',
      );
      expect(dots).toHaveLength(1);
      const [dot] = Array.from(dots);
      const x = Number(dot.getAttribute("cx"));
      const y = Number(dot.getAttribute("cy"));
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x !== 0 || y !== 0).toBe(true);
    });
  });

  /** The next-apsis countdown is withheld wherever the orbit model refuses to advance the elements, as under physics where they are osculating. */
  describe("the next-apsis countdown", () => {
    const orbit = {
      referenceBodyIndex: 0,
      sma: 8_000_000,
      ecc: 0.4,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0.5,
      epoch: 100,
      mu: KERBIN_MU,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    };
    const scene = (quality: number) => {
      render(
        <fixture.Provider>
          <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
        </fixture.Provider>,
      );
      primeStream();
      act(() => {
        fixture.emit("vessel.orbit", orbit, { quality });
      });
    };

    it("counts down to the next apsis while the craft is on rails", async () => {
      scene(0);
      await waitFor(() => expect(visibleText()).toMatch(/Next (Ap|Pe)/));
    });

    it("withholds it while the craft is under physics", async () => {
      scene(1);
      await waitFor(() =>
        expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
      );
      expect(visibleText()).not.toMatch(/Next (Ap|Pe)/);
    });
  });
});
