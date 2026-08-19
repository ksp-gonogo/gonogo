import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * CHARACTERISATION of what `undefined` MEANS to SystemView today, read off the
 * rendered output rather than off the source.
 *
 * The widget makes four telemetry reads (`vessel.orbit`, `vessel.identity`,
 * `vessel.target`, `system.bodies`) plus `useViewUt`, and gives `undefined` a
 * DIFFERENT meaning at nearly every site:
 *
 *  - `bodies.length === 0` prints "Waiting for body data..."
 *  - `identity?.parentBodyIndex != null` failing makes the frame fall back to
 *    the root star, so an absent vessel produces a confident frame label
 *  - `identity?.name` failing prints the literal string "Vessel"
 *  - `orbit?.encounter` failing prints no encounter suffix, the same render as a
 *    craft that genuinely has no encounter
 *  - `targetName` failing draws no target marker, the same render as no target
 *  - `parentName ?? NULL_DISPLAY` prints an em dash in compact mode
 *
 * Every one of those is an absence gate, and a `Reading` is always truthy.
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

  // ── 1. Nothing has arrived at all ────────────────────────────────────────

  it("says only 'Waiting for body data...' when no telemetry has arrived at all", () => {
    const { container } = mount();

    // The `bodies.length === 0` branch. It is the ONLY thing the widget says,
    // and it lives in the same polite live region that later carries the frame
    // label, so the transition out of it is announced.
    const caption = screen.getByText("Waiting for body data...");
    expect(caption).toHaveAttribute("role", "status");
    expect(caption).toHaveAttribute("aria-live", "polite");

    // Not merely "the container is empty": these are the specific things the
    // widget declines to draw. `parentName` is null, so the diagram is gated
    // out entirely rather than rendered with an empty body list.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(0);
    expect(visibleText(container)).not.toMatch(/Frame:/);

    // The almanac renders its own absence copy rather than a table of dashes,
    // because `panelBody` is null (no focus, and no vessel body to default to).
    expect(
      screen.getByText(/Hover or focus a body in the diagram/i),
    ).toBeInTheDocument();
    // No contact caption: `vesselGuid` is null so no contribution matches, and
    // `ContactCaption`'s `if (!status) return null` fires.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an em dash, not a waiting message, when it is too small for a diagram", () => {
    // Compact mode takes a different absence path: `parentName ?? NULL_DISPLAY`.
    const { container } = mount({}, { w: 3, h: 4 });

    // The em dash is the widget's whole answer about which frame it is showing,
    // while the caption above it still says data is being waited for. Two
    // different renderings of the same absent value, in one widget.
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

    // A tombstone reaches `useTelemetry` as `null`, `useCelestialBodies`'
    // `systemBodies?.bodies` gate catches it, and the widget reverts to the
    // never-arrived sentence. A confirmed "there are no bodies" is spoken as
    // "waiting", with no age attached to the confirmation.
    act(() => {
      fixture.emit("system.bodies", null, { validAt: 50, seq: 1 });
    });
    await waitFor(() =>
      expect(screen.getByText("Waiting for body data...")).toBeInTheDocument(),
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  // ── 2. Absence gates, proved to fire ─────────────────────────────────────

  it("names a frame confidently off the root star when no vessel telemetry exists", async () => {
    const { container } = mount({ frame: "auto" });
    // Bodies only: no vessel.identity, so `identity?.parentBodyIndex != null`
    // fails and `vesselBody` is null.
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
    });

    // `resolveFrame("auto", null)` falls back to the tree root, so the widget
    // asserts "Frame: Kerbin" with nothing whatsoever known about the craft.
    // Identical text to a vessel confirmed to be at Kerbin.
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

    // `useTelemetry("vessel.target")?.name` is undefined, coerced to null by
    // `typeof targetName === "string" ? ... : null`, so no body is drawn as the
    // target. Indistinguishable from a confirmed "no target set".
    expect(container.querySelectorAll(TARGET_DOT)).toHaveLength(0);

    act(() => {
      fixture.emit("vessel.target", { name: "Mun" });
    });
    // The contrast is what makes the assertion above load-bearing: the marker
    // exists, and only the absent read was keeping it off screen.
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

    // `orbit?.encounter ?? null` makes `encounterExists` 0, which is the same
    // value a craft on a closed orbit with no encounter produces. The caption
    // is the bare frame label either way.
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

    // `!orbit` in the `derived` and `orbitPatches` memos, plus `vesselOrbit`'s
    // own `orbit &&`: the widget declines to place anything for the craft
    // rather than placing it at the origin. The bodies still draw, so this is a
    // per-read absence, not a blank widget.
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

  // ── 3. A partial payload: the record arrived, fields inside did not ──────

  it("calls the craft the literal string 'Vessel' when identity carries no name", async () => {
    mount({ frame: "Kerbin" });
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      // A partial identity: the guid arrived, the name and the parent body did
      // not. The guid alone is enough to subscribe the silence topic.
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

    // `typeof identity?.name === "string" ? identity.name : "Vessel"` prints a
    // placeholder name inside an assertive live region, so a screen reader is
    // told "Vessel officially lost" for a craft whose name simply had not
    // arrived yet.
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

    // The gate is `identity?.parentBodyIndex != null`, so a present record with
    // an absent field takes the identical path to no record at all: the frame
    // label is the root star's name, stated as fact.
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
      });
    });

    // `orbit.lan?.magnitude ?? 0` (three separate call sites: `vesselOrbit`,
    // `orbitPatches`, `usePhaseAngles`) coerces both absences to zero, so the
    // dot is drawn at a definite place derived partly from values that never
    // arrived. There is no visual difference from an explicitly equatorial
    // orbit, and nothing marks the position as partly assumed.
    await waitFor(() =>
      expect(container.querySelectorAll(VESSEL_DOT)).toHaveLength(1),
    );
    const [dot] = Array.from(container.querySelectorAll(VESSEL_DOT));
    expect(Number.isFinite(Number(dot.getAttribute("cx")))).toBe(true);
    expect(Number.isFinite(Number(dot.getAttribute("cy")))).toBe(true);
  });
});
