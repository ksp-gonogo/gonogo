import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  type DrivableResizeObservers,
  expectNoA11yViolations,
  installDrivableResizeObserver,
} from "@ksp-gonogo/ui-kit/testing";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Meter, MeterRowGroup, MeterStack } from "./Meter";

/**
 * A list of row meters shares one set of columns, and decides for the whole
 * list whether the figures fit beside the bars. jsdom lays nothing out, so the
 * widths the decision reads are supplied here per part, and the decision is
 * read off the stack's attribute.
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

/** The widths a laid-out page would report, keyed by what the element is. */
interface Widths {
  stack: number;
  label: number;
  /** A label's width when it is allowed to wrap, if different. */
  wrappedLabel?: number;
  figure: number;
}

let widths: Widths;

function stubLayout(): void {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-testid") ? widths.stack : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      const part = this.dataset.meterPart;
      if (part === "figure") return widths.figure;
      if (part !== "label") return 0;
      return this.style.whiteSpace === "nowrap"
        ? widths.label
        : (widths.wrappedLabel ?? widths.label);
    },
  );
}

function Tanks() {
  return (
    <MeterStack data-testid="stack">
      <Meter
        label="Liquid Fuel"
        value={value("units", 300)}
        capacity={value("units", 400)}
        layout="row"
      />
      <Meter
        label="RCS"
        value={value("units", 30)}
        capacity={value("units", 40)}
        layout="row"
      />
    </MeterStack>
  );
}

const stack = () => screen.getByTestId("stack");

describe("MeterStack lining up row meters", () => {
  let observers: DrivableResizeObservers;
  beforeEach(() => {
    observers = installDrivableResizeObserver();
  });
  afterEach(() => {
    observers.uninstall();
    vi.restoreAllMocks();
  });

  it("keeps the figures beside the bars where label, bar floor and figure fit", () => {
    // 100 + 8 + 48 + 8 + 120 = 284; jsdom reads the gap as 0, so 268 is needed
    widths = { stack: 300, label: 100, figure: 120 };
    stubLayout();
    render(<Tanks />);
    expect(stack()).not.toHaveAttribute("data-figures-below");
  });

  it("moves every figure below its bar where they do not fit", () => {
    widths = { stack: 250, label: 100, figure: 120 };
    stubLayout();
    render(<Tanks />);
    expect(stack()).toHaveAttribute("data-figures-below");
  });

  it("decides again when the stack is resized", () => {
    widths = { stack: 300, label: 100, figure: 120 };
    stubLayout();
    render(<Tanks />);
    expect(stack()).not.toHaveAttribute("data-figures-below");
    widths.stack = 200;
    act(() => observers.resize(stack(), { width: 200, height: 40 }));
    expect(stack()).toHaveAttribute("data-figures-below");
    widths.stack = 400;
    act(() => observers.resize(stack(), { width: 400, height: 40 }));
    expect(stack()).not.toHaveAttribute("data-figures-below");
  });

  it("decides again when a figure grows without the stack changing size", () => {
    widths = { stack: 300, label: 100, figure: 120 };
    stubLayout();
    render(<Tanks />);
    const figure = stack().querySelector<HTMLElement>(
      '[data-meter-part="figure"]',
    );
    if (!figure) throw new Error("no figure");
    widths.figure = 200;
    act(() => observers.resize(figure, { width: 200, height: 14 }));
    expect(stack()).toHaveAttribute("data-figures-below");
  });

  it("measures a label on one line, not at the width a wrap left it", () => {
    // Wrapped, the label reads 40 and would fit; on one line it is 160 and does not
    widths = { stack: 300, label: 160, wrappedLabel: 40, figure: 120 };
    stubLayout();
    render(<Tanks />);
    expect(stack()).toHaveAttribute("data-figures-below");
  });

  it("counts a row meter inside a MeterRowGroup", () => {
    widths = { stack: 250, label: 100, figure: 120 };
    stubLayout();
    render(
      <MeterStack data-testid="stack">
        <MeterRowGroup>
          <Meter label="S1" value={value("ratio", 0.5)} layout="row" />
          <span>1min · TWR 1.2</span>
        </MeterRowGroup>
      </MeterStack>,
    );
    expect(stack()).toHaveAttribute("data-figures-below");
  });

  it("leaves a stack that has not been laid out undecided", () => {
    widths = { stack: 0, label: 100, figure: 120 };
    stubLayout();
    render(<Tanks />);
    expect(stack()).not.toHaveAttribute("data-figures-below");
  });

  it("has no axe violations", async () => {
    widths = { stack: 300, label: 100, figure: 120 };
    stubLayout();
    const { container } = render(<Tanks />);
    await expectNoA11yViolations(container);
  });
});

describe("a row meter's amount over a capacity", () => {
  /** Marks a reader can see: the halves' own are hidden in the row form. */
  function visibleMarks(label: string): Element[] {
    const track = screen.getByRole("meter", { name: label });
    const root = track.parentElement?.parentElement;
    if (!root) throw new Error("no meter root");
    return Array.from(root.querySelectorAll("[data-not-current-mark]")).filter(
      (mark) => getComputedStyle(mark).display !== "none",
    );
  }

  it("carries one not-current mark, after the capacity, when only the amount is held", () => {
    render(
      <Meter
        label="LF"
        value={held(value("units", 300))}
        capacity={value("units", 400)}
        layout="row"
      />,
    );
    const marks = visibleMarks("LF");
    expect(marks).toHaveLength(1);
    // After the whole phrase, not between the amount and the slash
    expect(marks[0]?.previousSibling?.textContent).toMatch(/400/);
  });

  it("carries one mark when both halves are held", () => {
    render(
      <Meter
        label="LF"
        value={held(value("units", 300))}
        capacity={held(value("units", 400))}
        layout="row"
      />,
    );
    expect(visibleMarks("LF")).toHaveLength(1);
  });

  it("carries none when both halves are current", () => {
    render(
      <Meter
        label="LF"
        value={value("units", 300)}
        capacity={value("units", 400)}
        layout="row"
      />,
    );
    expect(visibleMarks("LF")).toHaveLength(0);
  });

  it("keeps a mark on each held half in the stacked form", () => {
    render(
      <Meter
        label="LF"
        value={held(value("units", 300))}
        capacity={held(value("units", 400))}
      />,
    );
    expect(visibleMarks("LF")).toHaveLength(2);
  });
});
