import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * Fixtures that differ only in what the trajectory provider says its trajectories are, driven through the real widget.
 *
 * `integrated-arc-live.json` is a recorded `vessel.orbit` frame from an integrating provider (`trajectoryKind = 2`, a bounded horizon); `analytic-conic-live.json` is the same payload with the provider fields an analytic horizon publishes. Anything that differs below is the provider.
 *
 * Pins that an integrating provider's elements are drawn as an open curve stopped at its horizon, and that the predicted patch chain, gated on `shape === "conic"`, is absent for it.
 */

const FIXTURES = join(__dirname, "__fixtures__");

const CONTRIBUTIONS_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.vessel-status"] as const,
};

interface ProbeFixture {
  _stream: {
    pinnedUt: number;
    emits: {
      channel: string;
      value: unknown;
      meta?: Record<string, unknown>;
    }[];
  };
}

function loadFixture(name: string): ProbeFixture {
  const path = join(FIXTURES, `${name}.json`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} does not hold a JSON object`);
  }
  return parsed as ProbeFixture;
}

function WithContributions({ children }: { children: ReactNode }) {
  return (
    <WidgetMetaContext.Provider value={CONTRIBUTIONS_META}>
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

/** Mounts the widget and replays one fixture's emits exactly as the probe entry does; `omitChannel` drops one emit for the starve control. */
async function mountFixture(
  name: string,
  omitChannel?: string,
): Promise<HTMLElement> {
  const { _stream: stream } = loadFixture(name);
  const fixture = setupStreamFixture({
    pinnedUt: stream.pinnedUt,
    suspendFrames: true,
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

/** The live patch of the predicted chain, identified by the vessel accent stroke only it uses; the vessel's own curve is excluded by attribute. */
function predictedPatchPaths(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll(
      'path[stroke="var(--color-accent-fg)"][fill="none"]:not([data-vessel-trajectory])',
    ),
  );
}

/**
 * The largest absolute coordinate in a path's `d`, in SVG user units.
 * jsdom has no layout, but the auto-fit puts the outermost drawn thing at half the viewBox, so a curve's extent as a fraction of everything drawn is its share of the picture.
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
  it("draws an open, multi-point arc when the provider integrates", async () => {
    const container = await mountFixture("integrated-arc-live");
    await waitFor(() => {
      if (vesselCurves(container).length === 0) {
        throw new Error("the vessel curve has not rendered yet");
      }
    });
    expect(vesselCurves(container)).toEqual(["arc"]);
    const arc = container.querySelector('path[data-vessel-trajectory="arc"]');
    // The osculating conic sampled in its own plane, so it names perifocal (1).
    expect(arc?.getAttribute("data-trajectory-frame")).toBe("1");
    const d = arc?.getAttribute("d") ?? "";
    // Open: it stops at the provider's horizon.
    expect(d).not.toMatch(/z/i);
    // A sampled curve rather than a two-point stub.
    expect(d.match(/L/g)?.length ?? 0).toBeGreaterThan(10);
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
    // `orbitPatches` returns [] for anything but a conic.
    expect(predictedPatchPaths(integrated)).toHaveLength(0);
  });

  it("renders the recorded system, not an empty diagram", async () => {
    // Both fixtures carry the recorded 17-body stock system, so a widget fed nothing cannot produce these.
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
    // The starve control: one emit dropped, the vessel curve must disappear, or the selectors match something the orbit payload does not feed.
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
    // The reconstructed pair on kerbin-orbit-inclined's geometry, where the integrating answer's sampled conic is large enough to see.
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
    // The live pair renders near-identically because the auto-fit extent is Minmus's apoapsis, which a 250 km orbit is under two percent of; the reconstructed pair makes the difference visible.
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
