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
 * What AstronautComplex does when its `useTelemetry` reads come back
 * `undefined`. `complex === undefined` is a whole-widget early return to a
 * one-line empty state that names whether it is waiting or off career; the
 * other absences are per-field NULL_DISPLAY guards.
 */

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

  /** A cold start collapses like off-career does, but says it is waiting. */
  it("collapses to a waiting empty state, with NO tabs, when nothing has arrived", () => {
    // Everything below the title is replaced; only funds survive the early return, showing the placeholder.
    renderWidget();

    expect(
      screen.getByText("No applicant data yet (waiting for telemetry)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No applicant data (career mode only)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Funds")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    // These exist only past the gate.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Applicants" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Next Hire")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Kerbals")).not.toBeInTheDocument();
  });

  /** A known balance survives the early return. */
  it("still shows the funds figure inside the waiting empty state when only funds have arrived", async () => {
    // Both branches render the same funds `Stat`, so the assertion is on its spoken quantity.
    renderWidget();
    act(() => {
      fixture.emit("career.status", { balances: { funds: 500000 } });
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

  /** `absent` is off career, so a tombstone collapses to the career-only empty state. */
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
    // An undefined `career.status` is drawn as punctuation, never as zero funds.
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

  it("leaves Hire to the command on an unquoted price, and says no funds shortfall", async () => {
    // Applicants present, every numeric field missing: the cap readouts show the placeholder with no "/ capacity" suffix.
    renderWidget();
    act(() => {
      fixture.emit("spaceCenter.astronautComplex", { applicants: [APPLICANT] });
    });

    const hire = await screen.findByRole("button", {
      name: /^Hire Desdin Kerman/,
    });
    // No cost clause in the accessible name, and no availability claim of the widget's own.
    expect(hire).toHaveAccessibleName("Hire Desdin Kerman");
    expect(hire).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/Insufficient funds/)).not.toBeInTheDocument();
    // No denominator and no FULL claim without a known cap.
    const activeValue = screen.getByText("Active Kerbals").nextElementSibling;
    expect(activeValue).toHaveTextContent(NULL_DISPLAY);
    expect(activeValue?.textContent).not.toContain("/");
    expect(screen.queryByText("FULL")).not.toBeInTheDocument();
  });

  it("shows 'No active crew' on the Active tab when the crew roster never arrives", async () => {
    // An unread roster is presented as an empty one: nothing distinguishes "no crew hired" from a silent channel.
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
    // The same `[]` coercion on the action path: the serial input silently does nothing.
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
