import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { setKspCalendar, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  FundsDrain,
  netFundsPerDay,
  netFundsPerDayReading,
} from "./FundsDrain";

// Back to the stock Kerbin day after the one case that changes it. The
// calendar is module state in the SDK, so a test that leaves it moved makes
// every later cover figure in this file wrong by the calendar ratio.
afterEach(() => setKspCalendar());

describe("netFundsPerDay", () => {
  it("nets a subsidy against an upkeep", () => {
    expect(
      netFundsPerDay({
        subsidyPerDay: value("f/day", 1200),
        upkeepPerDay: value("f/day", 2180),
      }),
    ).toBe(-980);
  });

  it("is zero for stock's two honest zeros, not null", () => {
    expect(
      netFundsPerDay({
        subsidyPerDay: value("f/day", 0),
        upkeepPerDay: value("f/day", 0),
      }),
    ).toBe(0);
  });

  it("withholds a net when only the upkeep half arrived", () => {
    // Half an answer must not become a drain: an absent subsidy is unknown,
    // not zero.
    expect(netFundsPerDay({ upkeepPerDay: value("f/day", 2180) })).toBe(null);
  });

  it("withholds a net when no economy arrived at all", () => {
    expect(netFundsPerDay(undefined)).toBe(null);
  });
});

describe("netFundsPerDayReading", () => {
  const observed = <V,>(v: V): Reading<V> => ({
    state: "observed",
    value: v,
    atUt: value("ut", 1000),
    reckoning: { status: "none" },
  });

  /**
   * The two forms are one rate, so they are asserted against each other rather
   * than each against its own expected number: a drift in either subtraction
   * fails here even where both are self-consistent.
   */
  it("agrees with the bare form on the figure", () => {
    const economy = {
      subsidyPerDay: value("f/day", 1200),
      upkeepPerDay: value("f/day", 2180),
    };
    const reading = netFundsPerDayReading(
      observed(economy.subsidyPerDay),
      observed(economy.upkeepPerDay),
    );
    expect(reading.state).toBe("observed");
    expect(reading.value?.magnitude).toBe(netFundsPerDay(economy));
  });

  /**
   * The both-halves rule, which `combineReadings` enforces rather than a second
   * copy of the condition: an optional field the wire did not carry projects as
   * `observed` with no value, and a net worked out from one half would report a
   * drain the model never claimed.
   */
  it("withholds the net when a half carries no value, as the bare form does", () => {
    const notCarried: Reading<Value<"f/day">> = {
      state: "observed",
      atUt: value("ut", 1000),
      reckoning: { status: "none" },
    };
    const reading = netFundsPerDayReading(
      notCarried,
      observed(value("f/day", 2180)),
    );
    expect(reading.value).toBeUndefined();
    expect(netFundsPerDay({ upkeepPerDay: value("f/day", 2180) })).toBe(null);
  });

  it("is stale when either half is, so the figure can be drawn as held", () => {
    const held: Reading<Value<"f/day">> = {
      state: "stale",
      value: value("f/day", 1200),
      asOfUt: value("ut", 900),
      grade: "disconnected",
      reckoning: { status: "none" },
    };
    const reading = netFundsPerDayReading(held, observed(value("f/day", 2180)));
    expect(reading.state).toBe("stale");
    expect(reading.value?.magnitude).toBe(-980);
  });
});

describe("FundsDrain", () => {
  it("renders nothing when no model answered", () => {
    const { container } = render(
      <FundsDrain funds={289848} netPerDay={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the model reports no standing rate", () => {
    // Stock career. A "0 f/day" chip would read as a programme that
    // happens to break even rather than one with no such mechanism.
    const { container } = render(<FundsDrain funds={289848} netPerDay={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports a drain and how long the balance covers it", () => {
    render(<FundsDrain funds={289848} netPerDay={-980} />);
    // 289,848 funds against 980 a day. The cover figure goes through `Unit`
    // like every other quantity, so the day rung is the formatter's choice.
    // visibleText, not textContent: Unit ships a visually-hidden spoken word
    // ("funds per day") that a screen reader wants and a sighted operator never
    // sees, and textContent cannot tell the two apart.
    expect(visibleText()).toContain("980.0 f/day drain");
    expect(visibleText()).toContain("295d left");
  });

  it("reads the day off the running calendar, not off a baked constant", () => {
    // The same 295 game-days. `f/day`'s denominator is the game's own day
    // (SitrepUnitAttribute.FundsPerDay), so the division cancels it and the
    // cover figure must stay 295 whatever a day is worth in seconds. A figure
    // built on a hardcoded 86,400 would read 73d here and 1180d on stock.
    setKspCalendar({ day: 86_400, year: 365 * 86_400 });
    render(<FundsDrain funds={289848} netPerDay={-980} />);
    expect(visibleText()).toContain("295d left");
  });

  it("reports the drain alone when no balance is available to divide", () => {
    render(<FundsDrain funds={null} netPerDay={-980} />);
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
    expect(screen.getByText(/drain/)).toBeInTheDocument();
  });

  it("reports a credit rather than a drain when the subsidy wins", () => {
    render(<FundsDrain funds={289848} netPerDay={240} />);
    expect(screen.getByText(/credit/)).toBeInTheDocument();
  });

  it("shows the cover figure alone when compact", () => {
    render(<FundsDrain funds={289848} netPerDay={-980} compact />);
    expect(visibleText()).toContain("295d left");
    expect(visibleText()).not.toContain("drain");
  });

  it("does not report a negative cover on an overdrawn balance", () => {
    render(<FundsDrain funds={-500} netPerDay={-980} />);
    expect(visibleText()).toContain("0s left");
  });

  it("has no a11y violations", async () => {
    const { container } = render(
      <FundsDrain funds={289848} netPerDay={-980} />,
    );
    await expectNoA11yViolations(container);
  });
});
