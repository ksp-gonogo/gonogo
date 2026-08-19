import { DashboardItemContext } from "@ksp-gonogo/core";
import { vesselManeuverLegacyChannel } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * Characterisation of every place ManeuverPlanner reads `undefined` off
 * telemetry, recorded BEFORE `useTelemetry` becomes `Reading<T>`.
 *
 * The widget currently reads `undefined` with four different meanings, and
 * nothing in the codebase says which is which:
 *
 *  1. "no orbit has arrived, wait"     -> the awaiting-orbit empty state
 *  2. "there is no target set"         -> a confident "No target selected in-game."
 *  3. "there is no delta-V"            -> coerced to 0, then 0 is a null-display sentinel
 *  4. "no stream node id yet"          -> silently substitutes an array index
 *
 * Every assertion below pins one of those meanings as it is today.
 */

// `vessel.state` declares eight inputs and gates every field on all eight
// being carried, so the whole list rides along even when a test emits one.
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.maneuver",
  "dv.stages",
];

const PINNED_UT = 1_000_000;

// Rendered trees, unmounted before the fixture goes away: disposing a still
// mounted widget's provider is a state update outside act().
const renderedTrees: Array<() => void> = [];

function renderTracked(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function setup(config: Record<string, unknown> = {}) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: PINNED_UT,
  });
  fixture.store.registerDerivedChannel(vesselManeuverLegacyChannel);
  const view = renderTracked(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-characterise" }}>
        <ManeuverPlannerComponent id="mnv-characterise" config={config} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** A full, plan-ready `vessel.orbit`, matching stream.test.tsx's own. */
function emitOrbitReady(
  fixture: ReturnType<typeof setupStreamFixture>,
  overrides: Record<string, unknown> = {},
) {
  fixture.emit("vessel.orbit", {
    referenceBodyIndex: 1,
    sma: 700000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: PINNED_UT,
    mu: 3.5316e12,
    ...overrides,
  });
}

/** `useViewUt` only reaches its pinned value after a frame tick. */
async function flushViewUt(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/**
 * The widget's own content wrapper: the sibling right after the panel header,
 * inside `[data-panel-body]`.
 *
 * It used to reach for `[data-scroll-area-inner]`, an element that no longer
 * exists. This widget wrapped its whole body in a SECOND `ScrollArea` inside
 * `Panel.Body`, whose glow then drew inside the outer body's inset, and that
 * nesting was deleted. These tests are about the reference-body caption's
 * three states and never had anything to do with scrolling; the inner element
 * was only ever a convenient query root.
 *
 * Not `[data-panel-body]` itself, which was the obvious replacement and is
 * wrong: the header renders INSIDE it, so its first child is the title.
 */
function panelBody(container: HTMLElement): HTMLElement {
  const content = container.querySelector<HTMLElement>(
    "[data-panel-header] + *",
  );
  if (!content) throw new Error("panel content not found");
  return content;
}

describe("ManeuverPlanner: nothing has arrived at all", () => {
  it("renders the awaiting-orbit empty state, and no preview or commit control", async () => {
    const { view } = setup();
    // `vessel.orbit` undefined -> sma/ecc undefined -> planReady false. This is
    // meaning 1 of `undefined`: wait, nothing has come yet.
    expect(
      await screen.findByText("Awaiting orbit telemetry."),
    ).toBeInTheDocument();

    // Named absences rather than an empty container: a widget that renders
    // nothing would otherwise pass this whole file.
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add node" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add Node When..." }),
    ).not.toBeInTheDocument();

    // The sections around the empty state DO render: the panel is not blank.
    expect(screen.getByText("Planned nodes")).toBeInTheDocument();
    expect(screen.getByText("New maneuver")).toBeInTheDocument();
    expect(screen.getByText("No maneuver nodes planned.")).toBeInTheDocument();

    // The hyperbolic branch is the other side of the same `waiting` flag, and
    // an absent ecc does NOT take it.
    expect(screen.queryByText("Hyperbolic trajectory")).not.toBeInTheDocument();
    expect(visibleText(view.container)).toContain("MANEUVER PLANNER");
  });

  it("omits the reference-body caption entirely: the gate is `refBody !== undefined`", async () => {
    const { view } = setup();
    await screen.findByText("Awaiting orbit telemetry.");
    // With `vessel.state.referenceBodyName` never arrived the caption is not
    // rendered at all, so the scroll body opens on the first <section>.
    expect(panelBody(view.container).firstElementChild?.tagName).toBe(
      "SECTION",
    );
  });
});

describe("ManeuverPlanner: the absence gates fire today", () => {
  it("reports 'No target selected in-game.' from a vessel.target that never arrived", async () => {
    // `targetName = useTelemetry('vessel.target')?.name`, then PresetInput's
    // `targetName ? ... : "No target selected in-game."`. Meaning 2: absence is
    // read as a positive statement about the game, not as "we do not know".
    setup({ defaultPreset: "match-target-inclination" });
    expect(
      await screen.findByText("No target selected in-game."),
    ).toBeInTheDocument();
  });

  it("reports the SAME 'No target selected in-game.' for a confirmed vessel.target tombstone", async () => {
    // null vs undefined: this site does NOT distinguish them. `null?.name` and
    // `undefined?.name` are both undefined, so a confirmed "no target" and a
    // never-arrived target render one identical sentence.
    const { fixture } = setup({ defaultPreset: "match-target-inclination" });
    await screen.findByText("No target selected in-game.");
    act(() => {
      fixture.emit("vessel.target", null);
    });
    await waitFor(() =>
      expect(
        screen.getByText("No target selected in-game."),
      ).toBeInTheDocument(),
    );
  });

  it("drops that sentence once vessel.target actually arrives, proving the gate is what produced it", async () => {
    // Contrast case: without this, the assertion above could be passing because
    // the fixture feeds nothing rather than because the gate fires.
    const { fixture } = setup({ defaultPreset: "match-target-inclination" });
    await screen.findByText("No target selected in-game.");
    act(() => {
      fixture.emit("vessel.target", {
        name: "Mun",
        kind: 1,
        orbit: { inc: 0, lan: 0, sma: 1.2e7, argPe: 0, ecc: 0 },
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByText("No target selected in-game."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Target: Mun/)).toBeInTheDocument();
  });

  it("reports 'or target LAN unavailable' for match-target-plane, folding two absences into one string", async () => {
    // `targetName && targetLanLive !== undefined`: one gate over two separate
    // reads (`vessel.target` and `vessel.target.orbit.lan`), so the operator
    // cannot tell which of the two is missing.
    setup({ defaultPreset: "match-target-plane" });
    expect(
      await screen.findByText(
        "No target selected in-game (or target LAN unavailable).",
      ),
    ).toBeInTheDocument();
  });

  it("renders an EMPTY reference-body caption when system.bodies is a confirmed tombstone", async () => {
    // The one place this widget's undefined/null handling genuinely diverges.
    // `resolveBodyName` answers `null` (not undefined) for a tombstoned
    // `system.bodies`, and the caption's gate is `refBody !== undefined`, so
    // null passes it and an empty <div> is rendered where the body name goes.
    const { fixture, view } = setup();
    await screen.findByText("Awaiting orbit telemetry.");
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("system.bodies", null);
    });
    await waitFor(() => {
      const first = panelBody(view.container).firstElementChild;
      expect(first?.tagName).toBe("DIV");
      expect(first?.textContent).toBe("");
    });
  });
});

describe("ManeuverPlanner: the reference-body caption's three states", () => {
  it("renders the body name once system.bodies resolves the index", async () => {
    // Contrast case for the two caption assertions above: absent -> no element,
    // tombstone -> empty element, resolved -> the name.
    const { fixture, view } = setup();
    await screen.findByText("Awaiting orbit telemetry.");
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 1,
            name: "Kerbin",
            gravParameter: 3.5316e12,
            radius: 600000,
          },
        ],
      });
    });
    await waitFor(() => {
      const first = panelBody(view.container).firstElementChild;
      expect(first?.tagName).toBe("DIV");
      expect(first?.textContent).toBe("Kerbin");
    });
  });
});

describe("ManeuverPlanner: a partial vessel.orbit payload", () => {
  it("stays on the awaiting-orbit empty state when the record arrived but ecc did not", async () => {
    // The record is present, one field is not. Indistinguishable in the render
    // from the record being absent: `planReady` is a conjunction of positive
    // finite-number checks, so any one missing field reads as "no telemetry".
    const { fixture } = setup();
    await screen.findByText("Awaiting orbit telemetry.");
    act(() => {
      emitOrbitReady(fixture, { ecc: undefined });
    });
    await flushViewUt();
    expect(screen.getByText("Awaiting orbit telemetry.")).toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
  });

  it("shows the hyperbolic notice instead when ecc IS present and >= 1", async () => {
    // The contrast case that gives the test above its meaning: the widget can
    // only say "escaping" because it reads the raw ecc rather than the derived
    // orbit, so a PRESENT ecc is distinguished from an ABSENT one here and
    // nowhere else.
    const { fixture } = setup();
    await screen.findByText("Awaiting orbit telemetry.");
    act(() => {
      emitOrbitReady(fixture, { ecc: 1.5 });
    });
    expect(
      await screen.findByText("Hyperbolic trajectory"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Awaiting orbit telemetry."),
    ).not.toBeInTheDocument();
  });
});

describe("ManeuverPlanner: an absent node id becomes an array index", () => {
  it("dispatches the positional index as the nodeId when the node arrived without one", async () => {
    // Meaning 4, and a field-level absence inside a PRESENT record: the raw
    // `vessel.maneuver` read landed, its node just carries no `id`, so
    // `nodeIdAtPosition`'s `typeof real === "string"` gate falls through to
    // `String(index)`. `KspVesselActuator.RemoveManeuverNode` resolves only an
    // exact GUID match, so "0" can only ever come back NotFound: the widget
    // sends it anyway and reports nothing.
    const { fixture } = setup();
    const dispatched: Array<[string, unknown]> = [];
    fixture.transport.setCommandHandler((command, args) => {
      dispatched.push([command, args]);
      return { ok: true };
    });
    act(() => {
      emitOrbitReady(fixture);
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            ut: PINNED_UT + 120,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 30,
            dvTotal: 30,
            patches: [],
          },
        ],
      });
    });
    const deleteBtn = await screen.findByRole("button", {
      name: "Delete node",
    });
    // Wait on the raw read specifically, so a pass cannot come from the record
    // being absent instead of the field.
    await waitFor(() => {
      const point = fixture.store.sample(
        "vessel.maneuver",
        fixture.store.currentFrame(),
      );
      if (!point) throw new Error("vessel.maneuver frame not ready");
    });
    act(() => {
      deleteBtn.click();
    });
    await waitFor(() =>
      expect(dispatched).toEqual([["vessel.maneuver.remove", { nodeId: "0" }]]),
    );
  });
});

describe("ManeuverPlanner: dv.stages absent is coerced to zero", () => {
  it("renders the null-display dash for Available and no feasibility chip", async () => {
    // Meaning 3: `useVesselDeltaV` turns an absent `dv.stages` into
    // `totalVac: 0`, and the preview then reads 0 back as a NO-DATA sentinel
    // (`NULL_DISPLAY`), while `feasible` collapses to null so neither OK nor
    // SHORT is shown. A vessel with genuinely zero delta-V renders identically.
    const { fixture } = setup();
    act(() => {
      emitOrbitReady(fixture);
    });
    await flushViewUt();
    expect(await screen.findByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.queryByText("SHORT")).not.toBeInTheDocument();
    // The commit button is NOT disabled by the missing delta-V: only an
    // explicit `feasible === false` disables it, and null is not false.
    expect(screen.getByRole("button", { name: "Add node" })).toBeEnabled();
  });
});
