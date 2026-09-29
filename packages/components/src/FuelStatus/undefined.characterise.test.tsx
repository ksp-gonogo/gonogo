import { DashboardItemContext } from "@ksp-gonogo/core";
import { normaliseStage } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * Pins what FuelStatus renders for `undefined` at each of its reads: an absent capacity drops the resource row, the stage caption and its " / N" suffix are gated separately, the totals box drops only when both halves are absent, and a missing per-stage figure is NaN and draws a placeholder.
 */

function makeFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

/** Default size, 8x14: every size gate is open, so anything missing below is missing because of a data gate. */
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
    // At 8x14 the dash fallback is gated off (it needs `!showTotals`), so a widget fed nothing shows a titled frame and no readout.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() => expect(visibleText(container)).toContain("FUEL · ΔV"));
    // Totals box: both halves absent, so the whole box is gone.
    expect(screen.queryByText("Total ΔV")).not.toBeInTheDocument();
    expect(screen.queryByText("Total burn")).not.toBeInTheDocument();
    // Stage caption is gated on currentStage being present.
    expect(screen.queryByText(/^Stage /)).not.toBeInTheDocument();
    // Every resource row is dropped by max === 0, which is what an absent `vessel.resources` coerces to.
    expect(screen.queryByText("Liquid Fuel")).not.toBeInTheDocument();
    expect(screen.queryByText("Oxidizer")).not.toBeInTheDocument();
    expect(screen.queryByText("RCS")).not.toBeInTheDocument();
    expect(screen.queryByText("Power")).not.toBeInTheDocument();
    // Stage stack section: a cold topic, so no caption.
    expect(screen.queryByText(/Stages ·/)).not.toBeInTheDocument();
    // And no placeholder either: the em dash belongs to the tiny form.
    expect(screen.queryByText(NULL_DISPLAY)).not.toBeInTheDocument();
  });

  it("draws both tiny essentials as the null token at 3x3 before anything arrives", async () => {
    const fixture = makeFixture();
    const { container } = renderWidget("fuel-status", {
      w: 3,
      h: 3,
      wrapper: fixture.Provider,
    });

    await waitFor(() => expect(visibleText(container)).toContain("FUEL"));
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(2);
  });

  it("reads a resource with no reported capacity as a resource the vessel does not have", async () => {
    // The capacity is missing though the amount arrived; the row disappears, the same as a vessel with no RCS tank.
    const fixture = makeFixture();
    renderFuel(fixture);

    // Xenon is the positive control from the same frame; RCS proves the missing-max row was dropped.
    act(() => {
      fixture.emit("vessel.resources", {
        resources: {
          MonoPropellant: { current: 120 },
          XenonGas: { current: 400, max: 700 },
        },
      });
    });

    expect(
      await screen.findByRole("meter", { name: "Xenon · vessel" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^RCS/)).not.toBeInTheDocument();
  });

  it("reads a resource with no reported amount as unknown, not as an empty tank", async () => {
    // The tank is there (its capacity arrived) but its level did not, so the row stays and says it does not know, rather than drawing a drained tank.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.resources", {
        resources: { MonoPropellant: { max: 120 } },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("RCS · vessel")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("meter", { name: "RCS · vessel" })).toBeNull();
    expect(visibleText(container)).toContain(NULL_DISPLAY);
  });

  it("hides the stage caption while vessel.structure has not arrived, even with a stage count in hand", async () => {
    // `currentStage` gates the whole caption, so the known stage count is not shown either.
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
    // `stageCount !== undefined` gates only the " / N" suffix, so this half of the caption degrades in place rather than vanishing.
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
    // An undefined currentStage marks no row, rather than defaulting the marker onto stage 0.
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("dv.stages", [
        { stage: 2, dvActual: 2000, twrActual: 1.4, burnTime: 60 },
        { stage: 1, dvActual: 1500, twrActual: 1.2, burnTime: 40 },
      ]);
    });

    await waitFor(() => {
      const stages = screen
        .queryAllByRole("meter")
        .map((el) => el.getAttribute("aria-label"))
        .filter((name) => name !== null && /S\d$/.test(name));
      expect(stages).toEqual(["S2", "S1"]);
    });
  });

  it("shows an em dash for the missing half of the totals box and a real number for the other", async () => {
    // One half of the pair present renders the box, with a placeholder in the missing half.
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

  it("shows an em-dash burn and TWR for a stage row whose fields never arrived", async () => {
    // `normaliseStage` returns NaN for an uncarried field; a "0s" burn would claim a known zero.
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.stages", [{ stage: 1, dvActual: 1900 }]);
    });

    await waitFor(() => expect(visibleText(container)).toContain("1900 m/s"));
    expect(
      screen.getByText(
        new RegExp(`^${NULL_DISPLAY} · TWR\\s+${NULL_DISPLAY}$`),
      ),
    ).toBeInTheDocument();
    expect(visibleText(container)).not.toMatch(/\b0s\b/);
  });

  it("gives no stage row for undefined or null, the same as an empty array", () => {
    // Neither `undefined` nor a `null` tombstone is distinguishable from `[]`, a vessel with no stages.
    expect(normaliseStage(undefined)).toBeNull();
    expect(normaliseStage(null)).toBeNull();
  });

  it("spells a field the wire did not carry NaN, never 0", () => {
    // 0 m/s is a spent stage and NaN is a stage the sim had no figure for.
    const row = normaliseStage({ stage: 0, dryMass: 3 });
    expect(row?.dryMass).toBe(3);
    expect(row?.deltaVVac).toBeNaN();
    expect(row?.TWRActual).toBeNaN();
  });
});
