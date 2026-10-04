import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";

const ratio = (n: number) => value("ratio", n);

describe('Meter kind="progress"', () => {
  it("exposes progressbar semantics with the current value", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Biome coverage"
        value={ratio(0.42)}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Biome coverage" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("stays a meter by default", () => {
    render(<Meter label="Tank" value={ratio(0.5)} />);
    expect(screen.getByRole("meter", { name: "Tank" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clamps a fraction above 1 and below 0", () => {
    render(
      <>
        <Meter kind="progress" hideLabel label="Over" value={ratio(1.5)} />
        <Meter kind="progress" hideLabel label="Under" value={ratio(-0.1)} />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByRole("progressbar", { name: "Under" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("draws nothing at all for no figure when the label is hidden, since an empty track reads as 0%", () => {
    const { container } = render(
      <>
        <Meter kind="progress" hideLabel label="Coverage" value={null} />
        <Meter
          kind="progress"
          hideLabel
          label="Rate"
          value={ratio(Number.POSITIVE_INFINITY)}
        />
      </>,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the bar alone when the label is hidden, and the label and figure when it is not", () => {
    const { rerender } = render(
      <Meter kind="progress" hideLabel label="Research" value={ratio(0.3)} />,
    );
    expect(screen.queryByText("Research")).toBeNull();
    rerender(<Meter kind="progress" label="Research" value={ratio(0.3)} />);
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("uses fillColor over the tone for the fill", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Transit"
        value={ratio(0.9)}
        fillColor="var(--color-nogo-mark)"
      />,
    );
    const fill = screen.getByRole("progressbar").firstElementChild;
    expect(fill).toHaveStyle({ background: "var(--color-nogo-mark)" });
  });
});

describe('Meter kind="progress" driven by an amount and a capacity', () => {
  it("derives the fill from the pair", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Crew assigned"
        value={value("count", 3)}
        capacity={value("count", 4)}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "Crew assigned" }),
    ).toHaveAttribute("aria-valuenow", "75");
  });

  it("converts across rungs before dividing", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Propellant"
        value={value("kg", 500)}
        capacity={value("t", 1)}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("speaks both halves, so the fill is not the only reading", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Pad operation progress"
        value={value("bp", 120)}
        capacity={value("bp", 400)}
      />,
    );
    expect(
      screen.getByRole("progressbar").getAttribute("aria-valuetext"),
    ).toMatch(/120.*of.*400/);
  });

  it("draws nothing for a capacity of zero, which is no tank at all", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Crew assigned"
        value={value("count", 0)}
        capacity={value("count", 0)}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clamps a pair that overruns its capacity", () => {
    render(
      <Meter
        kind="progress"
        hideLabel
        label="Pad operation progress"
        value={value("bp", 500)}
        capacity={value("bp", 400)}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });
});
