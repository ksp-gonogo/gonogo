import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * Characterises what `undefined` means to SystemView, read off the rendered output. Each of its reads gives absence a different meaning:
 *
 *  - `bodies.length === 0` prints "Waiting for body data..."
 *  - a missing `identity?.parentBodyIndex` frames the root star, a confident label for an absent vessel
 *  - a missing `identity?.name` prints the literal "Vessel"
 *  - a missing `orbit?.encounter` renders the same as no encounter
 *  - a missing `targetName` renders the same as no target
 *  - compact mode prints `NULL_DISPLAY` for `parentName`
 *
 * Every one is an absence gate, and a `Reading` is always truthy.
 */

const KERBIN_MU = 3.5316e12;

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

/** Kerbin as the tree root (parentIndex null), with Mun and Minmus under it. */
function kerbinSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5138398e10,
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

function kerbinOrbitWithEncounter() {
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

/** The vessel dot; `SystemDiagram` paints it with the accent token alone. */
const VESSEL_DOT = 'circle[fill="var(--color-accent-fg)"]';
/** The target body's dot, the only thing `vessel.target` changes in the SVG. */
const TARGET_DOT = 'circle[fill="var(--color-status-nogo-bg)"]';

describe("SystemView: what undefined means today", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "vessel.target",
        "system.bodies",
        "fleet.",
        "silence.",
      ],
      pinnedUt: 100,
      suspendFrames: true,
    });
  });

  function mount(config: Record<string, unknown> = {}, size = {}) {
    return render(
      <fixture.Provider>
        <WithContributions>
          <SystemViewComponent config={config} id="sv" {...size} />
        </WithContributions>
      </fixture.Provider>,
    );
  }

  it("says only 'Waiting for body data...' when no telemetry has arrived at all", () => {
    const { container } = mount();

    // The only thing the widget says, in the same polite live region that later carries the frame label.
    const caption = screen.getByText("Waiting for body data...");
    expect(caption).toHaveAttribute("role", "status");
    expect(caption).toHaveAttribute("aria-live", "polite");

    // `parentName` is null, so the diagram is gated out entirely rather than drawn with no bodies.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(0);
    expect(visibleText(container)).not.toMatch(/Frame:/);

    // `panelBody` is null, so the almanac renders its own absence copy.
    expect(
      screen.getByText(/Hover or focus a body in the diagram/i),
    ).toBeInTheDocument();
    // `vesselGuid` is null, so no contribution matches and `ContactCaption` renders nothing.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an em dash, not a waiting message, when it is too small for a diagram", () => {
    // Compact mode takes a different absence path: `parentName ?? NULL_DISPLAY`.
    const { container } = mount({}, { w: 3, h: 4 });

    // Two renderings of one absent value: `NULL_DISPLAY` here, while the caption says data is awaited.
    expect(visibleText(container)).toContain(NULL_DISPLAY);
    expect(screen.getByText("Waiting for body data...")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("treats a null system.bodies payload exactly as never having heard", async () => {
    const { container } = mount();
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
    });
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
    );

    // A tombstone reaches the hook as `null` and reverts to the never-arrived sentence, with no age on the confirmation.
    act(() => {
      fixture.emit("system.bodies", null, { validAt: 50, seq: 1 });
    });
    await waitFor(() =>
      expect(screen.getByText("Waiting for body data...")).toBeInTheDocument(),
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("names a frame confidently off the root star when no vessel telemetry exists", async () => {
    const { container } = mount({ frame: "auto" });
    // Bodies only: no vessel.identity, so `identity?.parentBodyIndex != null` fails and `vesselBody` is null.
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
    });

    // `resolveFrame("auto", null)` falls back to the root, text identical to a vessel confirmed at Kerbin.
    await waitFor(() =>
      expect(screen.getByText("Frame: Kerbin")).toBeInTheDocument(),
    );
    // And it says nothing about the vessel it has never heard from.
    expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(0);
    expect(
      screen.getByText(/Hover or focus a body in the diagram/i),
    ).toBeInTheDocument();
  });

  it("draws no target marker while vessel.target is absent, then one when it lands", async () => {
    const { container } = mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Mun").length).toBeGreaterThan(0),
    );

    // No target body is drawn, indistinguishable from a confirmed "no target set".
    expect(container.querySelectorAll(TARGET_DOT)).toHaveLength(0);

    act(() => {
      fixture.emit("vessel.target", { name: "Mun" });
    });
    // The contrast: the marker exists, and only the absent read kept it off screen.
    await waitFor(() =>
      expect(container.querySelectorAll(TARGET_DOT)).toHaveLength(1),
    );
  });

  it("omits the encounter suffix while vessel.orbit is absent, then prints it when it lands", async () => {
    mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
    });

    // `encounterExists` is 0, the same as a closed orbit with no encounter.
    await waitFor(() =>
      expect(screen.getByText("Frame: Kerbin")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/next encounter/i)).toBeNull();

    act(() => {
      fixture.emit("vessel.orbit", kerbinOrbitWithEncounter());
    });
    await waitFor(() =>
      expect(screen.getByText(/next encounter:\s*Mun/i)).toBeInTheDocument(),
    );
  });

  it("draws neither a vessel dot nor a predicted arc while vessel.orbit is absent", async () => {
    const { container } = mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Mun").length).toBeGreaterThan(0),
    );

    // The craft is not placed at all rather than at the origin, while the bodies still draw.
    expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(0);
    const pathsWithoutOrbit = container.querySelectorAll("path").length;

    act(() => {
      fixture.emit("vessel.orbit", kerbinOrbitWithEncounter());
    });
    await waitFor(() =>
      expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(1),
    );
    expect(container.querySelectorAll("path").length).toBeGreaterThan(
      pathsWithoutOrbit,
    );
  });

  it("calls the craft the literal string 'Vessel' when identity carries no name", async () => {
    mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      // The guid alone is enough to subscribe the silence topic.
      fixture.emit("vessel.identity", { vesselId: "v" });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
    );
    act(() => {
      fixture.emit("silence.v.state", {
        state: "Lost",
        silenceSinceUt: 50,
        deadlineUt: 90,
        deadlineBasis: "predicted-reacquisition",
        predictedReacquisitionUt: 60,
      });
    });

    // A placeholder name inside an assertive live region: "Vessel officially lost" for a craft whose name has not arrived.
    const caption = await screen.findByText(/officially lost/i);
    expect(caption.closest("[role='alert']")).not.toBeNull();
    expect(visibleText(caption)).toContain("Vessel");
  });

  it("falls back to the root frame when identity arrives without a parentBodyIndex", async () => {
    mount({ frame: "auto" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", { vesselId: "v", name: "Tester" });
    });

    // A present record with an absent field takes the same path as no record: the root star's name, stated as fact.
    await waitFor(() =>
      expect(screen.getByText("Frame: Kerbin")).toBeInTheDocument(),
    );
  });

  it("plots the craft as if equatorial when the orbit record carries no lan or argPe", async () => {
    const { container } = mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      // lan and argPe are the two genuinely optional elements on the wire.
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 0,
        sma: 8_000_000,
        ecc: 0.4,
        inc: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 100,
        mu: KERBIN_MU,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      });
    });

    // `orbit.lan?.magnitude ?? 0` at three sites draws the dot at a definite place partly from values that never arrived, like an equatorial orbit.
    await waitFor(() =>
      expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(1),
    );
    const [dot] = Array.from(container.querySelectorAll(VESSEL_DOT));
    expect(Number.isFinite(Number(dot.getAttribute("cx")))).toBe(true);
    expect(Number.isFinite(Number(dot.getAttribute("cy")))).toBe(true);
  });
});
