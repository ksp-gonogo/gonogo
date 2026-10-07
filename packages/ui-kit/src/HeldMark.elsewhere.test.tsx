import {
  type Reading,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { HeldFigure, ReckoningMark } from "./HeldMark";
import { RECKONING_MARK } from "./reckoningMarkSpec";
import { TinyEssentials } from "./TinyEssentials";

const mark = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-held-mark]");

describe("the mark of a figure that is of something else", () => {
  it("draws nothing for a current figure of the thing its label names", () => {
    const { container } = render(<ReckoningMark kind="current" />);
    expect(mark(container)).toBeNull();
  });

  it("draws a hollow mark of the figure's own kind, and says which it is", () => {
    for (const kind of ["current", "held", "modelled"] as const) {
      const { container } = render(<ReckoningMark kind={kind} elsewhere />);
      const drawn = mark(container);
      expect(drawn?.getAttribute("data-reckoning-mark")).toBe(kind);
      expect(drawn?.hasAttribute("data-elsewhere")).toBe(true);
    }
  });

  it("leaves the filled held and modelled marks as they were", () => {
    for (const kind of ["held", "modelled"] as const) {
      const { container } = render(<ReckoningMark kind={kind} />);
      expect(mark(container)?.hasAttribute("data-elsewhere")).toBe(false);
    }
  });

  it("gives every hollow form a floor two pixels over the filled held square, so its hole stays open", () => {
    expect(RECKONING_MARK.held.domSize).toContain("4px");
    for (const kind of ["current", "held", "modelled"] as const) {
      const floor = Number(
        /(\d+)px\)$/.exec(RECKONING_MARK[kind].hollowDomSize)?.[1],
      );
      expect(floor).toBeGreaterThanOrEqual(6);
    }
  });

  it("says the caption after the figure, and has no axe violations", async () => {
    const { container } = render(
      <HeldFigure kind="current" elsewhere caption="Measured on another path">
        23 %
      </HeldFigure>,
    );
    expect(container.textContent).toBe("23 %, Measured on another path");
    expect(mark(container)).not.toBeNull();
    await expectNoA11yViolations(container);
  });
});

describe("a tiny essential's stated mark", () => {
  const strength = value("%", 23);
  const tile = (essential: Partial<TinyEssential>) =>
    render(
      <TinyEssentials
        title="Signal"
        essentials={[{ label: "Signal", value: strength, ...essential }]}
      />,
    ).container;

  it("draws no mark where none is stated", () => {
    expect(mark(tile({}))).toBeNull();
  });

  it("draws the ring for a figure of now that is of something else, and says the caption", () => {
    const container = tile({
      mark: { elsewhere: true, caption: "measured on another path" },
    });
    expect(mark(container)?.getAttribute("data-reckoning-mark")).toBe(
      "current",
    );
    expect(mark(container)?.hasAttribute("data-elsewhere")).toBe(true);
    expect(container.textContent).toContain("measured on another path");
  });

  it("draws the modelled triangle where the widget states the figure was worked out", () => {
    const container = tile({
      mark: { kind: "modelled", caption: "worked out" },
    });
    expect(mark(container)?.getAttribute("data-reckoning-mark")).toBe(
      "modelled",
    );
    expect(mark(container)?.hasAttribute("data-elsewhere")).toBe(false);
  });

  it("keeps a held Reading's own kind and empties its square where the figure is of something else", () => {
    const held: Reading<Value<"%">> = {
      state: "held",
      reckoning: { status: "none" },
      value: strength,
      asOfUt: value("ut", 100),
      grade: "held",
    };
    const container = tile({
      value: held,
      mark: { elsewhere: true, caption: "measured on another path" },
    });
    expect(container.querySelectorAll("[data-held-mark]")).toHaveLength(1);
    expect(mark(container)?.getAttribute("data-reckoning-mark")).toBe("held");
    expect(mark(container)?.hasAttribute("data-elsewhere")).toBe(true);
  });

  it("ignores a stated mark beside a state word", () => {
    expect(
      mark(tile({ word: "LOS", mark: { elsewhere: true, caption: "x" } })),
    ).toBeNull();
  });
});
