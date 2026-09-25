import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter";
import { NULL_DISPLAY } from "./NullValue";

/**
 * The row layout: label, bar and figure on one line, for a dense list of
 * meters. Everything a meter says is the same in both layouts; these pin that
 * the arrangement changes and nothing else does.
 */

const AT = value("ut", 12_000);

function held<U extends string>(figure: Value<U>): Reading<Value<U>> {
  return {
    state: "stale",
    value: figure,
    asOfUt: AT,
    grade: "held-stale",
    reckoning: { status: "none" },
  };
}

/**
 * The meter's outer box, reached from its accessible track: the track sits in
 * the bar, and the bar is a child of the root in both layouts.
 */
function rootOf(label: string): HTMLElement {
  const track = screen.getByRole("meter", { name: label });
  const root = track.parentElement?.parentElement;
  if (!(root instanceof HTMLElement)) throw new Error("no meter root");
  return root;
}

describe("Meter layout", () => {
  it("stacks the label and figure above the bar by default", () => {
    render(<Meter label="Dose" value={value("ratio", 0.4)} />);
    const root = rootOf("Dose");
    expect(root.children).toHaveLength(2);
    const label = screen.getByText("Dose");
    // The label shares a head line with the figure, and the bar is below it
    expect(label.parentElement).not.toBe(root);
    expect(label.parentElement?.parentElement).toBe(root);
  });

  it("puts label, bar and figure on one line, in that order, in the row form", () => {
    render(<Meter label="RCS" value={value("ratio", 0.4)} layout="row" />);
    const root = rootOf("RCS");
    const [label, bar, figure] = Array.from(root.children);
    expect(label).toHaveTextContent("RCS");
    expect(bar).toContainElement(screen.getByRole("meter", { name: "RCS" }));
    expect(figure).toHaveTextContent("40");
    expect(root.children).toHaveLength(3);
  });

  it("draws the same fill and speaks the same value in both layouts", () => {
    render(
      <>
        <Meter
          label="Stacked"
          value={value("units", 600)}
          capacity={value("units", 1200)}
        />
        <Meter
          label="Row"
          value={value("units", 600)}
          capacity={value("units", 1200)}
          layout="row"
        />
      </>,
    );
    const stacked = screen.getByRole("meter", { name: "Stacked" });
    const row = screen.getByRole("meter", { name: "Row" });
    expect(row).toHaveAttribute("aria-valuenow", "50");
    expect(row.getAttribute("aria-valuenow")).toBe(
      stacked.getAttribute("aria-valuenow"),
    );
    expect(row.getAttribute("aria-valuetext")).toBe(
      stacked.getAttribute("aria-valuetext"),
    );
  });

  it("writes an amount over a capacity with the unit once in the row form", () => {
    render(
      <>
        <Meter
          label="Stacked"
          value={value("units", 600)}
          capacity={value("units", 1200)}
        />
        <Meter
          label="Row"
          value={value("units", 600)}
          capacity={value("units", 1200)}
          layout="row"
        />
      </>,
    );
    const symbols = (label: string) =>
      rootOf(label).querySelectorAll("[data-unit]").length;
    expect(symbols("Stacked")).toBe(2);
    expect(symbols("Row")).toBe(1);
  });

  it("keeps the held treatment in the row form: dimmed fill and the not-current mark", () => {
    render(
      <Meter
        label="LF"
        value={held(value("units", 300))}
        capacity={held(value("units", 1200))}
        layout="row"
      />,
    );
    const root = rootOf("LF");
    expect(root.querySelector("[data-fill-not-current]")).not.toBeNull();
    expect(root.querySelector("[data-track-not-current]")).not.toBeNull();
    expect(root.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("draws the absent form on one line too", () => {
    render(<Meter label="Xenon" value={null} layout="row" />);
    expect(screen.queryByRole("meter", { name: "Xenon" })).toBeNull();
    const label = screen.getByText("Xenon");
    const root = label.parentElement;
    expect(root?.children).toHaveLength(3);
    expect(root).toHaveTextContent(NULL_DISPLAY);
  });

  it("has no axe violations in the row form", async () => {
    const { container } = render(
      <Meter
        label="Oxidizer"
        value={held(value("units", 300))}
        capacity={value("units", 1200)}
        layout="row"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
