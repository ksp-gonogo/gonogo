import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";

const ratio = (n: number) => value("ratio", n);

describe("Meter", () => {
  it("exposes meter semantics with the current value", () => {
    render(<Meter hideLabel label="Biome coverage" value={ratio(0.42)} />);
    const bar = screen.getByRole("meter", { name: "Biome coverage" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("is one role whatever it measures, a level or work toward an end", () => {
    render(<Meter label="Tank" value={ratio(0.5)} />);
    expect(screen.getByRole("meter", { name: "Tank" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clamps a fraction above 1 and below 0", () => {
    render(
      <>
        <Meter hideLabel label="Over" value={ratio(1.5)} />
        <Meter hideLabel label="Under" value={ratio(-0.1)} />
      </>,
    );
    expect(screen.getByRole("meter", { name: "Over" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByRole("meter", { name: "Under" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("draws nothing at all for no figure when the label is hidden, since an empty track reads as 0%", () => {
    const { container } = render(
      <>
        <Meter hideLabel label="Coverage" value={null} />
        <Meter hideLabel label="Rate" value={ratio(Number.POSITIVE_INFINITY)} />
      </>,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the bar alone when the label is hidden, and the label and figure when it is not", () => {
    const { rerender } = render(
      <Meter hideLabel label="Research" value={ratio(0.3)} />,
    );
    expect(screen.queryByText("Research")).toBeNull();
    rerender(<Meter label="Research" value={ratio(0.3)} />);
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("uses fillColor over the tone for the fill", () => {
    render(
      <Meter
        hideLabel
        label="Transit"
        value={ratio(0.9)}
        fillColor="var(--color-nogo-mark)"
      />,
    );
    const fill = screen.getByRole("meter").firstElementChild;
    expect(fill).toHaveStyle({ background: "var(--color-nogo-mark)" });
  });
});

describe("Meter driven by an amount and a capacity", () => {
  it("derives the fill from the pair", () => {
    render(
      <Meter
        hideLabel
        label="Crew assigned"
        value={value("count", 3)}
        capacity={value("count", 4)}
      />,
    );
    expect(
      screen.getByRole("meter", { name: "Crew assigned" }),
    ).toHaveAttribute("aria-valuenow", "75");
  });

  it("converts across rungs before dividing", () => {
    render(
      <Meter
        hideLabel
        label="Propellant"
        value={value("kg", 500)}
        capacity={value("t", 1)}
      />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
  });

  it("speaks both halves, so the fill is not the only reading", () => {
    render(
      <Meter
        hideLabel
        label="Pad operation progress"
        value={value("bp", 120)}
        capacity={value("bp", 400)}
      />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-valuetext")).toMatch(
      /120.*of.*400/,
    );
  });

  it("draws nothing for a capacity of zero, which is no tank at all", () => {
    render(
      <Meter
        hideLabel
        label="Crew assigned"
        value={value("count", 0)}
        capacity={value("count", 0)}
      />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("clamps a pair that overruns its capacity", () => {
    render(
      <Meter
        hideLabel
        label="Pad operation progress"
        value={value("bp", 500)}
        capacity={value("bp", 400)}
      />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("Meter statement", () => {
  it("writes the amount of its capacity under a bar drawn alone", () => {
    const { container } = render(
      <Meter
        hideLabel
        statement
        label="Nodes researched"
        value={value("count", 3)}
        capacity={value("count", 5)}
      />,
    );
    const statement = container.querySelector('[data-meter-part="statement"]');
    expect(statement).toHaveTextContent("3 / 5");
    // The label is still only the accessible name.
    expect(screen.queryByText("Nodes researched")).toBeNull();
    expect(
      screen.getByRole("meter", { name: "Nodes researched" }),
    ).toBeInTheDocument();
  });

  it("follows a capacity that changes, which the bar alone cannot say", () => {
    const { container, rerender } = render(
      <Meter
        hideLabel
        statement
        label="Liquid fuel"
        value={value("kg", 200)}
        capacity={value("kg", 400)}
      />,
    );
    const before = screen.getByRole("meter").getAttribute("aria-valuenow");
    // A tank staged away: half as much of half as much is the same bar.
    rerender(
      <Meter
        hideLabel
        statement
        label="Liquid fuel"
        value={value("kg", 100)}
        capacity={value("kg", 200)}
      />,
    );
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe(
      before,
    );
    expect(
      container.querySelector('[data-meter-part="statement"]'),
    ).toHaveTextContent(/100.* \/ .*200/);
  });

  it("writes the headed figure with the slash, in its head", () => {
    const { container } = render(
      <Meter
        statement
        label="Ore"
        value={value("kg", 120)}
        capacity={value("kg", 400)}
      />,
    );
    expect(container).toHaveTextContent(/120.* \/ .*400/);
    expect(container).not.toHaveTextContent(" of ");
    // Headed, the figure stays in the head: no second line under the bar.
    expect(container.querySelector('[data-meter-part="statement"]')).toBeNull();
  });

  it("keeps the slash without it", () => {
    const { container } = render(
      <Meter
        label="Ore"
        value={value("kg", 120)}
        capacity={value("kg", 400)}
      />,
    );
    expect(container).toHaveTextContent("/");
  });

  it("draws no statement line for a bar alone that did not ask for one", () => {
    const { container } = render(
      <Meter
        hideLabel
        label="Ore"
        value={value("kg", 120)}
        capacity={value("kg", 400)}
      />,
    );
    expect(container.querySelector('[data-meter-part="statement"]')).toBeNull();
  });

  it("draws nothing at all for no figure, statement or not", () => {
    const { container } = render(
      <Meter hideLabel statement label="Ore" value={null} capacity={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
