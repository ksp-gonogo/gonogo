import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { kspCalendar, STOCK_KERBIN_CALENDAR, setKspCalendar } from "./kspTime";
import { MissionDateField, partsOfUt, utOfParts } from "./MissionDateField";

describe("partsOfUt and utOfParts", () => {
  it("puts the epoch at year one day one, as every other date here does", () => {
    expect(partsOfUt(0)).toEqual({
      year: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it("round-trips an instant through its calendar components", () => {
    const ut =
      5 * STOCK_KERBIN_CALENDAR.year + 213 * STOCK_KERBIN_CALENDAR.day + 3723;

    expect(utOfParts(partsOfUt(ut))).toBe(ut);
  });

  it("drops a fraction of a second rather than showing one instant and holding another", () => {
    expect(utOfParts(partsOfUt(100.75))).toBe(100);
  });

  it("clamps a negative instant to the epoch instead of a negative year", () => {
    expect(partsOfUt(-500).year).toBe(1);
    expect(partsOfUt(-500).day).toBe(1);
  });

  it("reads the calendar the game reported, not a compiled-in Kerbin", () => {
    setKspCalendar({
      ...STOCK_KERBIN_CALENDAR,
      day: 86_400,
      year: 86_400 * 365,
    });
    try {
      // One Earth day in, which is day 2 on this calendar and day 5 on Kerbin's.
      expect(partsOfUt(86_400).day).toBe(2);
      expect(kspCalendar().day).toBe(86_400);
    } finally {
      setKspCalendar(STOCK_KERBIN_CALENDAR);
    }
  });

  it("carries an out-of-range component instead of refusing it", () => {
    // Typing 30 into the hour field of a six-hour day should reach the day after
    // next, not be clamped: the operator should not have to do the carry.
    const rolled = utOfParts({
      year: 1,
      day: 1,
      hour: 30,
      minute: 0,
      second: 0,
    });

    expect(partsOfUt(rolled).day).toBe(6);
  });
});

describe("MissionDateField", () => {
  it("offers a field per calendar component rather than one seconds box", () => {
    render(<MissionDateField value={0} onChange={() => {}} label="Ignition" />);

    for (const name of ["YEAR", "DAY", "HR", "MIN", "SEC"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("reports the whole instant when one component is typed over", async () => {
    // Controlled, as every real caller is: the field renders the instant it was
    // given, so a test that never feeds the change back is typing into a box
    // that keeps resetting.
    function Harness() {
      const [ut, setUt] = useState(0);
      return <MissionDateField value={ut} onChange={setUt} label="Ignition" />;
    }
    render(<Harness />);

    await userEvent.clear(screen.getByLabelText("DAY"));
    await userEvent.type(screen.getByLabelText("DAY"), "3");

    expect(screen.getByLabelText("DAY")).toHaveValue(3);
    // Day 3 of year 1 is two whole days in, because the calendar is one-based.
    expect(screen.getByLabelText("HR")).toHaveValue(0);
  });

  it("nudges by whole units of the live calendar", async () => {
    const onChange = vi.fn();
    render(
      <MissionDateField
        value={STOCK_KERBIN_CALENDAR.day}
        onChange={onChange}
        label="Ignition"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Ignition later by 1h" }),
    );

    expect(onChange).toHaveBeenCalledWith(
      STOCK_KERBIN_CALENDAR.day + STOCK_KERBIN_CALENDAR.hour,
    );
  });

  it("names each nudge for a screen reader, so a row of plus signs is readable", () => {
    render(<MissionDateField value={0} onChange={() => {}} label="Plan end" />);

    expect(
      screen.getByRole("button", { name: "Plan end earlier by 1d" }),
    ).toBeInTheDocument();
  });

  it("disables every control together", () => {
    render(
      <MissionDateField
        value={0}
        onChange={() => {}}
        label="Ignition"
        disabled
      />,
    );

    expect(screen.getByLabelText("DAY")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Ignition later by 1d" }),
    ).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <MissionDateField value={1234} onChange={() => {}} label="Ignition" />,
    );

    await expectNoA11yViolations(container);
  });
});
