import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY, speakQuantity } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

/**
 * Characterisation, not specification: what AstronautComplex DOES today when
 * its `useTelemetry` reads come back `undefined`.
 *
 * The load-bearing site is `if (complex === undefined)`, a whole-widget early
 * return that swaps the header + Applicants/Active tabs for a one-line empty
 * state. It is also the one place in this widget where `null` and `undefined`
 * mean different things: the empty state names which of the two it is, and the
 * tombstone case below pins that both reach it (the pre-migration gate let the
 * tombstone through and drew the full widget instead).
 *
 * The remaining absence sites are all `magnitudeOf(...) !== null` guards over
 * fields inside the payload, each rendering NULL_DISPLAY on its own.
 */
const CARRIED = [
  "spaceCenter.astronautComplex",
  "spaceCenter.crewRoster",
  "career.status",
  "career.crew.hire",
  "career.crew.fire",
];

const APPLICANT = {
  name: "Desdin Kerman",
  trait: "Scientist",
  experienceLevel: 0,
  courage: 0.65,
  stupidity: 0.2,
};

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

describe("AstronautComplex, what undefined telemetry renders today", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
  });

  function renderWidget(id = "astronaut-complex") {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <AstronautComplexComponent config={{}} id={id} w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  /**
   * Recorded prior behaviour: "collapses to the career-only empty state, with NO
   * tabs, when nothing has arrived". A cold start was reported as a save with no
   * space programme, because one gate served both "nothing yet" and "off
   * career".
   *
   * The collapse is unchanged, only the sentence: `pending` now says it is
   * waiting, and "career mode only" is kept for the producer confirming there is
   * no Complex.
   */
  it("collapses to a waiting empty state, with NO tabs, when nothing has arrived", () => {
    // The `complex === undefined` gate firing. Everything below the panel title
    // is replaced: no tablist, no header stat boxes, no applicant list. The
    // only reads that survive the early return are funds, which has not
    // arrived either and shows the em dash.
    renderWidget();

    expect(
      screen.getByText("No applicant data yet (waiting for telemetry)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No applicant data (career mode only)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Funds")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    // The gate's whole observable effect: these exist only past it.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Applicants" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Next Hire")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Kerbals")).not.toBeInTheDocument();
  });

  /**
   * Recorded prior behaviour: "still shows the funds figure inside the empty
   * state when only funds have arrived", where that empty state read "career
   * mode only".
   *
   * The funds rule is unchanged: a known balance survives the early return. Only
   * the accompanying sentence moved, for the same reason as the case above.
   */
  it("still shows the funds figure inside the waiting empty state when only funds have arrived", async () => {
    // Partial: the widget's own funds rule survives the early return, so an
    // undefined complex does NOT suppress a known balance.
    //
    // The two branches now render the SAME cell: this used to assert a
    // `title="Available funds"` that existed only on the empty state's own
    // funds readout, because the empty state and the header each drew the
    // figure themselves and only one was reachable at a time. Both go through
    // one `Stat` built once above the gate, so the assertion is on the spoken
    // quantity the header always used, and there is no second treatment left to
    // pin.
    renderWidget();
    act(() => {
      fixture.emit("career.status", { economy: { funds: 500000 } });
    });

    await waitFor(() =>
      expect(
        screen.getByTitle(
          speakQuantity(value("funds", 500_000), { decimals: 0 }),
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("No applicant data yet (waiting for telemetry)"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  /**
   * Recorded prior behaviour: "RENDERS THE FULL WIDGET for a confirmed tombstone,
   * because the gate tests undefined strictly". A confirmed no-Complex sailed
   * past `complex === undefined` and drew the whole header plus both tabs with em
   * dashes in every cell, so the save with no space programme got the richer
   * display of the two and the cold start got the empty state.
   *
   * The inversion is gone: `absent` is now the case the "career mode only"
   * wording exists for, and it collapses to that empty state.
   */
  it("COLLAPSES to the career-only empty state for a confirmed tombstone, because absent means off career", async () => {
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", null);
    });

    await waitFor(() =>
      expect(
        screen.getByText("No applicant data (career mode only)"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("No applicant data yet (waiting for telemetry)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Applicants" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Next Hire")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Kerbals")).not.toBeInTheDocument();
  });

  it("shows an em dash for funds in the header while the complex payload is present", async () => {
    // `careerFunds !== null` gate on the far side of the early return: an
    // undefined `career.status` read is drawn as punctuation, never as zero
    // funds, so a widget that spends money shows no balance rather than a
    // wrong one.
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", {
        applicants: [APPLICANT],
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: 24000,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Desdin Kerman")).toBeInTheDocument(),
    );
    const fundsValue = screen.getByText("Funds").nextElementSibling;
    expect(fundsValue).toHaveTextContent(NULL_DISPLAY);
  });

  it("treats an undefined hire cost as UNAFFORDABLE, disabling Hire with 'Insufficient funds'", async () => {
    // A partial payload with the applicant list present but every numeric field
    // missing. `affordable = nextHireCost !== null && ...`, so an absent cost
    // collapses to false and the operator is told they cannot afford a price
    // nobody has quoted. The cap readouts go to em dash with no "/ capacity"
    // suffix at all.
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", { applicants: [APPLICANT] });
    });

    const hire = await screen.findByRole("button", {
      name: /Insufficient funds/,
    });
    expect(hire).toBeDisabled();
    // The accessible name carries no cost clause, because `costText` is "".
    expect(hire).toHaveAccessibleName(
      "Hire Desdin Kerman (Insufficient funds)",
    );
    // Active Kerbals: em dash, and no " / n" denominator since capKnown is
    // false. FULL is not claimed either, rosterFull needs a known cap.
    const activeValue = screen.getByText("Active Kerbals").nextElementSibling;
    expect(activeValue).toHaveTextContent(NULL_DISPLAY);
    expect(activeValue?.textContent).not.toContain("/");
    expect(screen.queryByText("FULL")).not.toBeInTheDocument();
  });

  it("shows 'No active crew' on the Active tab when the crew roster never arrives", async () => {
    // `readCrewRoster(undefined)` returns `[]`, so an unread roster is
    // presented as a definitively empty one. Nothing on screen distinguishes
    // "no crew hired" from "the roster channel is silent".
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", {
        applicants: [APPLICANT],
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: 24000,
      });
    });

    const activeTab = await screen.findByRole("tab", { name: "Active" });
    act(() => {
      activeTab.click();
    });

    await waitFor(() =>
      expect(screen.getByText("No active crew")).toBeInTheDocument(),
    );
  });

  it("makes the fireHighlighted action a no-op while the crew roster is undefined", async () => {
    // Same `[]` coercion, on the action path rather than the render path: the
    // handler's `availableCrew.length === 0` early return is reached because an
    // undefined roster became an empty array, so the serial input silently does
    // nothing instead of erroring or firing the wrong kerbal.
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", {
        applicants: [APPLICANT],
        activeCrew: 3,
        crewCapacity: 13,
        nextHireCost: 24000,
      });
    });
    await screen.findByText("Desdin Kerman");

    act(() => {
      dispatchAction("astronaut-complex", "highlightNextAvailable", {
        kind: "button",
        value: true,
      });
    });
    act(() => {
      dispatchAction("astronaut-complex", "fireHighlighted", {
        kind: "button",
        value: true,
      });
    });

    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "career.crew.fire",
      ),
    ).toHaveLength(0);
  });
});
