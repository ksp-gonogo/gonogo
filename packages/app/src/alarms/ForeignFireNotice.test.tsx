import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ForeignFireNotice } from "./ForeignFireNotice";
import type { AlarmSnapshot, ForeignScetAlarm } from "./types";

const KSC = "ground:Kerbal Space Center";
const PILOT = "vessel:6f0a-probe";

const ROSTER = [
  { id: KSC, displayName: "KSC", active: true, isHome: true },
  { id: PILOT, displayName: "Sally-Hut 1", active: true, isHome: false },
];

const row: ForeignScetAlarm = {
  id: "pe",
  name: "periapsis low",
  armedBy: PILOT,
  state: "fired",
  condition: {
    kind: "threshold",
    topic: "vessel.flight",
    fieldPath: "altitudeAsl",
    op: "<",
    value: 70000,
  },
  withheld: false,
};

/** The same row as the simulation sends it to a screen at another vantage. */
const withheld: ForeignScetAlarm = {
  ...row,
  name: "",
  condition: null,
  withheld: true,
};

function snapshotWith(foreign: ForeignScetAlarm): AlarmSnapshot {
  return {
    alarms: [],
    ut: 0,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: 10,
    scetForeign: [foreign],
    scetForeignFired: [{ id: foreign.id, firedAtUt: 100 }],
  };
}

function renderAt(vantage: string, snap: AlarmSnapshot, onAck = vi.fn()) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const result = render(
    <fixture.Provider>
      <ForeignFireNotice snap={snap} onAcknowledge={onAck} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit(
      "vessel.control",
      { sasMode: 0, throttle: 0, actionGroups: [] },
      { validAt: 0, deliveredAt: 0, vantage },
    );
    fixture.emit("commandCentre.roster", ROSTER, { vantage });
    fixture.store.beginFrame();
  });
  return { ...result, onAck };
}

describe("ForeignFireNotice", () => {
  it("announces that an alarm armed at another vantage fired, by that centre's name and without its condition", () => {
    renderAt(KSC, snapshotWith(withheld));
    expect(screen.getByText("Alarm armed at Sally-Hut 1")).toBeInTheDocument();
    expect(screen.queryByText("periapsis low")).not.toBeInTheDocument();
  });

  it("names the alarm at the vantage that armed it", () => {
    renderAt(PILOT, snapshotWith(row));
    expect(screen.getByText("periapsis low")).toBeInTheDocument();
  });

  it("hands the id back on acknowledge", async () => {
    const { onAck } = renderAt(KSC, snapshotWith(withheld));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAck).toHaveBeenCalledWith("pe");
  });

  it("renders nothing when no foreign alarm has fired", () => {
    const { container } = renderAt(KSC, {
      ...snapshotWith(row),
      scetForeignFired: undefined,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderAt(KSC, snapshotWith(withheld));
    await expectNoA11yViolations(container);
  });
});
