import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { FundsDrain, netFundsPerDay } from "./FundsDrain";

describe("netFundsPerDay", () => {
  it("nets a subsidy against an upkeep", () => {
    expect(
      netFundsPerDay({
        subsidyPerDay: value("funds/day", 1200),
        upkeepPerDay: value("funds/day", 2180),
      }),
    ).toBe(-980);
  });

  it("is zero for stock's two honest zeros, not null", () => {
    expect(
      netFundsPerDay({
        subsidyPerDay: value("funds/day", 0),
        upkeepPerDay: value("funds/day", 0),
      }),
    ).toBe(0);
  });

  it("withholds a net when only the upkeep half arrived", () => {
    // Half an answer must not become a drain: an absent subsidy is unknown,
    // not zero.
    expect(netFundsPerDay({ upkeepPerDay: value("funds/day", 2180) })).toBe(
      null,
    );
  });

  it("withholds a net when no economy arrived at all", () => {
    expect(netFundsPerDay(undefined)).toBe(null);
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
    // Stock career. A "0 funds/day" chip would read as a programme that
    // happens to break even rather than one with no such mechanism.
    const { container } = render(<FundsDrain funds={289848} netPerDay={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports a drain and how long the balance covers it", () => {
    render(<FundsDrain funds={289848} netPerDay={-980} />);
    expect(screen.getByText(/295 days left/)).toBeInTheDocument();
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

  it("shows the days figure alone when compact", () => {
    render(<FundsDrain funds={289848} netPerDay={-980} compact />);
    expect(screen.getByText("295 days")).toBeInTheDocument();
    expect(screen.queryByText(/drain/)).not.toBeInTheDocument();
  });

  it("does not report a negative number of days on an overdrawn balance", () => {
    render(<FundsDrain funds={-500} netPerDay={-980} />);
    expect(screen.getByText(/0 days left/)).toBeInTheDocument();
  });

  it("has no a11y violations", async () => {
    const { container } = render(
      <FundsDrain funds={289848} netPerDay={-980} />,
    );
    await expectNoA11yViolations(container);
  });
});
