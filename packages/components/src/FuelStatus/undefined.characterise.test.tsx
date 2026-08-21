import { DashboardItemContext } from "@ksp-gonogo/core";
import { normaliseStage } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * What `undefined` MEANS at each of this widget's telemetry reads, as the code
 * stands today.
 *
 * Recorded before `useTelemetry` becomes a `Reading` union. This widget has the
 * widest spread of undefined-meanings of any in the set: one read coerces to
 * ZERO, one renders a placeholder, one omits a whole section, one omits a whole
 * BOX, and one renders a confident "0s".
 *
 * The gates:
 * - `magnitudeOr(vesselResources?.[name]?.current, 0)` and the same for `max`
 *   (index.tsx:134-135) coerce absence to zero, and the row is then dropped by
 *   `.filter(({ max }) => max > 0)` (index.tsx:277). So an unknown capacity is
 *   rendered as a resource the vessel does not carry, and an unknown amount is
 *   rendered as an empty tank
 * - `currentStage !== undefined` (index.tsx:585) gates the stage caption, and
 *   `s.stage === currentStage` (index.tsx:374) leaves NO stage highlighted
 * - `stageCount !== undefined` (index.tsx:588) gates the " / N" suffix
 * - `showTotals && (totalDv !== undefined || totalBurnTime !== undefined)`
 *   (index.tsx:612) drops the entire totals box when both are absent, while a
 *   partial pair renders the box with an em dash in the missing half
 * - `!showHeroDv && !showTotals && totalDv === undefined` (index.tsx:608)
 *   renders an em dash, but ONLY at sizes too small for the totals box
 * - `DELTA_V_BUDGET`'s stage loop turns a cold `dv.stages` into the same empty
 *   stack an empty array gives, and `normaliseStage`'s `Number.NaN` fallback is
 *   what every per-stage placeholder below comes from
 */

const CARRIED = [
  "vessel.structure",
  "vessel.resources",
  "dv.stages",
  "dv.summary",
];

function makeFixture() {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
}

/** Default size: cols 8, rows 14, so every section's SIZE gate is open and
 *  anything missing below is missing because of a data gate. */
function renderFuel(
  fixture: ReturnType<typeof setupStreamFixture>,
  size: { w?: number; h?: number } = {},
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider
        value={{ instanceId: "fuel-characterise" }}
      >
        <FuelStatusComponent
          config={{}}
          id="fuel-characterise"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("FuelStatus: what undefined means today", () => {
  it("renders the panel title and nothing else at full size before anything arrives", async () => {
    // The nothing-has-arrived case at the default 8x14. Named absences rather
    // than an empty container: at this size the em-dash fallback is gated OFF
    // (it needs `!showTotals`), so a fully-sized widget fed nothing shows a
    // titled frame with no readout, no placeholder, and no caption saying why.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() => expect(visibleText(container)).toContain("FUEL · ΔV"));
    // Totals box: both halves absent, so the whole box is gone.
    expect(screen.queryByText("Total ΔV")).not.toBeInTheDocument();
    expect(screen.queryByText("Total burn")).not.toBeInTheDocument();
    // Stage caption is gated on currentStage being present.
    expect(screen.queryByText(/^Stage /)).not.toBeInTheDocument();
    // Every resource row is dropped by max === 0, which is what an absent
    // `vessel.resources` coerces to.
    expect(screen.queryByText("Liquid Fuel")).not.toBeInTheDocument();
    expect(screen.queryByText("Oxidizer")).not.toBeInTheDocument();
    expect(screen.queryByText("RCS")).not.toBeInTheDocument();
    expect(screen.queryByText("Power")).not.toBeInTheDocument();
    // Stage stack section: parseStages([]) of a cold topic, so no caption.
    expect(screen.queryByText(/Stages ·/)).not.toBeInTheDocument();
    // And no placeholder either: the em dash belongs to the small-size branch.
    expect(screen.queryByText(NULL_DISPLAY)).not.toBeInTheDocument();
  });

  it("renders an em dash instead, at a size too small for the totals box", async () => {
    // Same data (none), different size, different meaning shown: at 3x3
    // `showTotals` is false so the explicit `totalDv === undefined` branch
    // fires and the widget prints a placeholder. The comment on that branch
    // says it exists so "the tiny widget doesn't appear blank", which is the
    // clearest statement in the file that undefined means "no data yet" here.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture, { w: 3, h: 3 });

    await waitFor(() => expect(visibleText(container)).toContain("FUEL · ΔV"));
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("reads a resource with no reported capacity as a resource the vessel does not have", async () => {
    // The `magnitudeOr(..., 0)` + `filter(max > 0)` pair, on `max`. The vessel
    // genuinely carries 120 units of monoprop and says so; only the capacity is
    // missing from the frame. The row disappears entirely, which is the same
    // rendering as a vessel with no RCS tank at all.
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.resources", {
        resources: { MonoPropellant: { current: 120 } },
      });
    });

    // Wait on a positive control from the SAME frame, so this is not just
    // asserting on a render that never happened: Xenon proves the frame landed
    // and was read, and RCS proves the missing-max row was dropped.
    act(() => {
      fixture.emit(
        "vessel.resources",
        {
          resources: {
            MonoPropellant: { current: 120 },
            XenonGas: { current: 400, max: 700 },
          },
        },
        { validAt: 5 },
      );
    });

    await waitFor(() => expect(screen.getByText("Xenon")).toBeInTheDocument());
    expect(screen.queryByText("RCS")).not.toBeInTheDocument();
  });

  it("reads a resource with no reported amount as an empty tank", async () => {
    // The same coercion on `current`. Absence becomes a confident 0.00 and a
    // zero-width bar: the operator is shown a drained tank rather than an
    // unknown one, and there is no placeholder anywhere in the row.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.resources", {
        resources: { MonoPropellant: { max: 120 } },
      });
    });

    await waitFor(() => expect(screen.getByText("RCS")).toBeInTheDocument());
    // A zero, not a placeholder: nothing in the row says the amount is unknown.
    expect(visibleText(container)).toContain("0.00 / 120.0");
    expect(visibleText(container)).not.toContain(NULL_DISPLAY);
    const fills = Array.from(
      container.querySelectorAll("div[style*='width']"),
    ).map((el) => (el as HTMLElement).style.width);
    expect(fills).toContain("0%");
  });

  it("hides the stage caption while vessel.structure has not arrived, even with a stage count in hand", async () => {
    // `currentStage !== undefined` gates the whole caption, so the stage COUNT
    // the widget already knows is not shown either. Absence of the line is the
    // only signal that the current stage is unknown.
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("dv.summary", { stageCount: 3, totalDvActual: 4200 });
    });

    // Positive control: the totals box proves the dv.summary frame landed.
    await waitFor(() =>
      expect(screen.getByText("Total ΔV")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Stage /)).not.toBeInTheDocument();
  });

  it("writes a bare 'Stage 0' with no stage count when dv.summary has not arrived", async () => {
    // `stageCount !== undefined` gates only the " / N" suffix, so this half of
    // the caption degrades in place rather than vanishing.
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 0 });
    });

    await waitFor(() =>
      expect(screen.getByText("Stage 0")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Stage 0 \//)).not.toBeInTheDocument();
  });

  it("highlights no stage at all when the current stage is unknown", async () => {
    // `s.stage === currentStage` with currentStage undefined matches nothing,
    // so the stack renders with every row unmarked rather than defaulting the
    // marker onto stage 0. Pinning it because "no marker" is easy to lose.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("dv.stages", [
        { stage: 2, deltaVActual: 2000, TWRActual: 1.4, burnTime: 60 },
        { stage: 1, deltaVActual: 1500, TWRActual: 1.2, burnTime: 40 },
      ]);
    });

    await waitFor(() => {
      const stageTexts = Array.from(container.querySelectorAll("span"))
        .map((el) => el.textContent ?? "")
        .filter((t) => /^[▶ ] S\d$/.test(t));
      expect(stageTexts).toEqual(["  S2", "  S1"]);
    });
  });

  it("shows an em dash for the missing half of the totals box and a real number for the other", async () => {
    // Partial payload: `dv.summary` arrived, `totalDvActual` did not. The box
    // renders because ONE of the pair is present, and the missing half reads as
    // a placeholder, so here undefined means "unknown" and is drawn as such.
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("dv.summary", { stageCount: 2, totalBurnTime: 125 });
    });

    await waitFor(() =>
      expect(screen.getByText("Total ΔV")).toBeInTheDocument(),
    );
    expect(screen.getByText("Total burn")).toBeInTheDocument();
    expect(screen.getByText("2min 5s")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("shows a confident '0s' burn and an em-dash TWR for a stage row whose fields never arrived", async () => {
    // `parseStages`'s `num()` returns NaN for a field no wire name matched, and
    // the two consumers then disagree about what that NaN means: TWR renders
    // the honest placeholder, while burn time renders "0s", a claim that the
    // stage has a known zero burn. Both come from the same absence.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.stages", [{ stage: 1, deltaVActual: 1900 }]);
    });

    await waitFor(() => expect(visibleText(container)).toContain("1900 m/s"));
    expect(
      screen.getByText(new RegExp(`TWR\\s+${NULL_DISPLAY}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/0s/)).toBeInTheDocument();
  });

  it("gives no stage row for undefined or null, the same as an empty array", () => {
    // The absence gate. `undefined` (nothing has arrived) and `null` (a
    // confirmed tombstone) both fail `normaliseStage`'s object check, so neither
    // is distinguishable from `[]`, a vessel with genuinely no stages.
    expect(normaliseStage(undefined)).toBeNull();
    expect(normaliseStage(null)).toBeNull();
  });

  it("spells a field the wire did not carry NaN, never 0", () => {
    // 0 m/s is a spent stage and NaN is a stage the sim had no figure for. The
    // per-stage placeholders above are `Number.isFinite` checks reading this.
    const row = normaliseStage({ stage: 0, dryMass: 3 });
    expect(row?.dryMass).toBe(3);
    expect(row?.deltaVVac).toBeNaN();
    expect(row?.TWRActual).toBeNaN();
  });
});
