import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * The probe fixtures that differ ONLY in what the trajectory provider says its
 * trajectories ARE, driven through the real widget so the render harness cannot
 * be the first thing to find out what they draw.
 *
 * `integrated-arc-live.json` is a `vessel.orbit` frame recorded off a live
 * integrating provider: `trajectoryKind = 2`, a 76-point wire arc in the
 * body-centred inertial frame. `analytic-conic-live.json` is the same recorded
 * payload with the three provider fields set to what
 * `VesselViewProvider.AnalyticHorizon` publishes. Same elements, same bodies,
 * same UT, so anything that differs below is the provider. Named for the
 * `TrajectoryKind` values rather than for whichever mod supplied them, because
 * that enum is the whole of what this widget branches on.
 *
 * Two things this pins that no existing test does. The arc arm has only ever
 * been exercised against a synthetic horizon with no wire arc, where
 * `sampleArc` supplies the points, so the `BodyCentredInertial` rotation on a
 * real recorded arc was untested end to end. And the predicted patch chain is
 * gated on `shape === "conic"`, which means an integrating provider loses it:
 * that is asserted here as behaviour rather than left to a reader of the gate.
 */

const FIXTURES = join(__dirname, "__fixtures__");

const CONTRIBUTIONS_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.vessel-status"] as const,
};

interface ProbeFixture {
  _stream: {
    carriedChannels: string[];
    pinnedUt: number;
    emits: {
      channel: string;
      value: unknown;
      meta?: Record<string, unknown>;
    }[];
  };
}

function loadFixture(name: string): ProbeFixture {
  return JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), "utf8"),
  ) as ProbeFixture;
}

function WithContributions({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider value={CONTRIBUTIONS_META}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

/**
 * Mounts the widget and replays one fixture's emits, exactly as the probe entry
 * does: same `setupStreamFixture`, same carried channels, same pinned UT, same
 * order. `omitChannel` drops one emit, which is how the starve control below
 * proves the assertions are sensitive to being fed.
 */
async function mountFixture(
  name: string,
  omitChannel?: string,
): Promise<HTMLElement> {
  const { _stream: stream } = loadFixture(name);
  const fixture = setupStreamFixture({
    carriedChannels: stream.carriedChannels,
    pinnedUt: stream.pinnedUt,
  });
  const { container } = render(
    <fixture.Provider>
      <WithContributions>
        <SystemViewComponent config={{}} id={`sv-${name}`} w={14} h={14} />
      </WithContributions>
    </fixture.Provider>,
  );
  act(() => {
    for (const emit of stream.emits) {
      if (emit.channel === omitChannel) continue;
      fixture.emit(emit.channel, emit.value, emit.meta);
    }
  });
  await act(async () => {});
  return container;
}

/** Every path the diagram drew for the vessel's own trajectory. */
function vesselCurves(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("path[data-vessel-trajectory]"),
  ).map((p) => p.getAttribute("data-vessel-trajectory") ?? "");
}

/**
 * The live patch of the predicted chain: `PredictedPatchArc` carries no data
 * attribute, so it is identified by the one stroke only it uses (the vessel
 * accent, on a filled-none open path). The vessel's own curve is excluded by
 * attribute, so the two cannot be confused.
 */
function predictedPatchPaths(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll(
      'path[stroke="var(--color-accent-fg)"][fill="none"]:not([data-vessel-trajectory])',
    ),
  );
}

/**
 * The largest absolute coordinate in a path's `d`, in SVG user units.
 *
 * jsdom has no layout, so this is not a pixel measurement. It does not need to
 * be: the diagram's auto-fit puts the outermost thing it draws at half the
 * viewBox, so a curve's own extent AS A FRACTION of the extent of everything
 * drawn is exactly how much of the picture that curve occupies, and that is the
 * quantity the live pair's renders turn on.
 */
function pathExtent(el: Element | null): number {
  const d = el?.getAttribute("d") ?? "";
  let max = 0;
  for (const n of d.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)) {
    max = Math.max(max, Math.abs(Number(n[0])));
  }
  return max;
}

/** How much of the drawn picture the vessel's own curve takes up. */
function vesselCurveShare(container: HTMLElement): number {
  const curve = pathExtent(
    container.querySelector("path[data-vessel-trajectory]"),
  );
  const drawn = Math.max(
    ...Array.from(container.querySelectorAll("path[data-body-orbit]")).map(
      pathExtent,
    ),
  );
  return drawn > 0 ? curve / drawn : 0;
}

describe("SystemView under an integrating provider against an analytic one", () => {
  it("draws the recorded n-body arc, open and multi-point, when the provider integrates", async () => {
    const container = await mountFixture("integrated-arc-live");
    await waitFor(() => {
      if (vesselCurves(container).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurves(container)).toEqual(["arc"]);
    const arc = container.querySelector('path[data-vessel-trajectory="arc"]');
    // Rotated out of the wire's body-centred inertial frame into the perifocal
    // one the diagram lifts from, so the arc names perifocal (1), not the 2 it
    // arrived as.
    expect(arc?.getAttribute("data-trajectory-frame")).toBe("1");
    const d = arc?.getAttribute("d") ?? "";
    // Open by construction: it stops where the integrator stopped.
    expect(d).not.toMatch(/z/i);
    // One `L` per captured point after the first, so the whole arc is on screen
    // rather than a two-point stub that would also satisfy "a path exists".
    expect(d.match(/L/g)?.length).toBe(75);
  });

  it("draws a closed conic when the provider is analytic", async () => {
    const container = await mountFixture("analytic-conic-live");
    await waitFor(() => {
      if (vesselCurves(container).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurves(container)).toEqual(["conic"]);
    expect(
      container
        .querySelector('path[data-vessel-trajectory="conic"]')
        ?.getAttribute("d") ?? "",
    ).toMatch(/Z$/);
  });

  it("loses the predicted patch chain on the integrated answer and keeps it on the conic", async () => {
    const analytic = await mountFixture("analytic-conic-live");
    await waitFor(() => {
      if (predictedPatchPaths(analytic).length === 0) {
        throw new Error("the predicted patch has not rendered yet");
      }
    });
    const integrated = await mountFixture("integrated-arc-live");
    await waitFor(() => {
      if (vesselCurves(integrated).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    // `orbitPatches` returns [] on anything but a conic, so the craft that has
    // the better trajectory is the one the diagram predicts nothing for.
    expect(predictedPatchPaths(integrated)).toHaveLength(0);
  });

  it("renders the recorded system, not an empty diagram", async () => {
    // The fixture-feeds-something control: both fixtures carry the recorded
    // 17-body stock system with the craft about Kerbin, so a widget that was
    // fed nothing cannot produce these.
    for (const name of ["integrated-arc-live", "analytic-conic-live"]) {
      const container = await mountFixture(name);
      await waitFor(() => {
        if (container.querySelectorAll("path[data-body-orbit]").length === 0) {
          throw new Error(`${name}: no body orbits rendered`);
        }
      });
      expect(await screen.findAllByText(/Kerbin/i)).not.toHaveLength(0);
      expect(
        container.querySelectorAll('[data-body="Mun"], [data-body="Minmus"]')
          .length,
      ).toBeGreaterThan(0);
    }
  });

  it("draws no vessel curve at all when vessel.orbit is withheld", async () => {
    // The starve control for every assertion above. Same fixture, same mount,
    // one emit dropped: if the vessel curve still appeared, the selectors would
    // be matching something the orbit payload does not feed.
    const container = await mountFixture("integrated-arc-live", "vessel.orbit");
    await waitFor(() => {
      if (container.querySelectorAll("path[data-body-orbit]").length === 0) {
        throw new Error("the bodies have not rendered yet");
      }
    });
    expect(vesselCurves(container)).toEqual([]);
    expect(predictedPatchPaths(container)).toHaveLength(0);
  });

  it("keeps the same arc-against-conic split on an orbit big enough to see", async () => {
    // The reconstructed pair, on kerbin-orbit-inclined's geometry. Same three
    // provider fields, no wire arc on either side, so the integrating answer
    // goes through the spine's own conic-sampling fallback rather than carried
    // points. That path had never been rendered.
    const integrated = await mountFixture("integrated-arc-wide");
    await waitFor(() => {
      if (vesselCurves(integrated).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurves(integrated)).toEqual(["arc"]);
    expect(predictedPatchPaths(integrated)).toHaveLength(0);

    const analytic = await mountFixture("analytic-conic-wide");
    await waitFor(() => {
      if (vesselCurves(analytic).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurves(analytic)).toEqual(["conic"]);
    expect(predictedPatchPaths(analytic).length).toBeGreaterThan(0);
  });

  it("draws the live orbit too small to see, and the wide one large enough", async () => {
    // Why the live pair's PNGs come out byte-identical. Nothing is wrong with
    // either fixture: the auto-fit extent is Minmus's apoapsis, and a 250 km
    // orbit against 47 Mm is under two percent of it, so the whole
    // arc-against-conic difference lands inside a couple of pixels. The
    // reconstructed pair exists to put the same difference where it can be
    // seen, and this is the measurement that says so rather than asserting it.
    const live = await mountFixture("integrated-arc-live");
    await waitFor(() => {
      if (vesselCurves(live).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurveShare(live)).toBeLessThan(0.03);

    const wide = await mountFixture("integrated-arc-wide");
    await waitFor(() => {
      if (vesselCurves(wide).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurveShare(wide)).toBeGreaterThan(0.3);
  });
});
