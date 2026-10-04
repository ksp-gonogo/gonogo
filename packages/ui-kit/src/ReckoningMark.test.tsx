import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  derivedMarking,
  paintReckonedPosition,
  ReckoningMarkSvg,
} from "./index";
import { Unit } from "./Unit";

const AT = value("ut", 1_000);

function carried(held: boolean): Reading<Value<"m">> {
  const reckoning = {
    status: "available" as const,
    atUt: value("ut", 1_100),
    beyondReceived: true,
    modelled: value("m", 20_000),
    basis: "kepler-propagation" as const,
  };
  return held
    ? {
        state: "held",
        value: value("m", 12_000),
        asOfUt: AT,
        grade: "held",
        reckoning,
      }
    : { state: "observed", value: value("m", 12_000), atUt: AT, reckoning };
}

describe("a figure a model carried", () => {
  it("is marked with the modelled triangle where it asks for the model", () => {
    const { container } = render(<Unit value={carried(false)} reckoned />);
    expect(container.textContent).toContain("20");
    expect(
      container.querySelector('[data-reckoning-mark="modelled"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-reckoning-mark="held"]')).toBeNull();
    expect(
      container.querySelector("[data-reckoned]")?.getAttribute("data-reckoned"),
    ).toBe("modelled");
  });

  it("is marked modelled over a held observation, keeping the grade's words", () => {
    const { container } = render(<Unit value={carried(true)} reckoned />);
    expect(
      container.querySelector('[data-reckoning-mark="modelled"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-unit-currency]")?.textContent,
    ).toMatch(/HELD.*modelled/);
  });

  it("keeps the held dot, and the observation, where it does not ask for the model", () => {
    const { container } = render(<Unit value={carried(true)} />);
    expect(
      container.querySelector('[data-reckoning-mark="held"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("12");
  });
});

describe("the SVG face", () => {
  it("draws a dot for held and a triangle for modelled", () => {
    const { container } = render(
      <svg aria-hidden="true">
        <ReckoningMarkSvg kind="held" x={5} y={5} />
        <ReckoningMarkSvg kind="modelled" x={20} y={5} ghost />
      </svg>,
    );
    expect(
      container.querySelector("circle[data-reckoning-mark=held]"),
    ).not.toBeNull();
    const triangle = container.querySelector(
      "polygon[data-reckoning-mark=modelled]",
    );
    expect(triangle?.getAttribute("opacity")).toBe("0.45");
  });
});

describe("paintReckonedPosition", () => {
  function fakeCtx() {
    const ctx: Partial<CanvasRenderingContext2D> = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      globalAlpha: 1,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };
    return ctx as CanvasRenderingContext2D;
  }

  it("draws the held position faint beside a modelled one, joined by a track", () => {
    const canvas = document.createElement("canvas");
    const ctx = fakeCtx();
    const alphas: number[] = [];
    vi.spyOn(ctx, "fill").mockImplementation(() => {
      alphas.push(ctx.globalAlpha);
    });
    paintReckonedPosition(canvas, ctx, {
      held: { x: 10, y: 10 },
      modelled: { x: 30, y: 20 },
    });
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(alphas).toEqual([0.45, 1]);
  });

  it("draws a held position alone at full strength", () => {
    const canvas = document.createElement("canvas");
    const ctx = fakeCtx();
    const alphas: number[] = [];
    vi.spyOn(ctx, "fill").mockImplementation(() => {
      alphas.push(ctx.globalAlpha);
    });
    paintReckonedPosition(canvas, ctx, { held: { x: 10, y: 10 } });
    expect(alphas).toEqual([1]);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe("a figure derived from a reading", () => {
  it("takes no mark from a current reading with no model past the edge", () => {
    const current: Reading<Value<"m">> = {
      state: "observed",
      value: value("m", 1),
      atUt: AT,
      reckoning: { status: "none" },
    };
    expect(derivedMarking(current)).toBeNull();
  });

  it("is modelled where a model carries a current reading past the received edge", () => {
    expect(derivedMarking(carried(false))?.kind).toBe("modelled");
  });

  it("is modelled over a held reading a model carries, and held where none does", () => {
    expect(derivedMarking(carried(true))?.kind).toBe("modelled");
    const held: Reading<Value<"m">> = {
      state: "held",
      value: value("m", 1),
      asOfUt: AT,
      grade: "held",
      reckoning: { status: "none" },
    };
    expect(derivedMarking(held)?.kind).toBe("held");
  });

  it("draws the mark on a bare quantity handed to Unit as marked", () => {
    const { container } = render(
      <Unit
        value={value("m", 5_000)}
        marked={derivedMarking(carried(false))}
      />,
    );
    expect(
      container.querySelector('[data-reckoning-mark="modelled"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-unit-currency]")?.textContent,
    ).toContain("modelled to SCET");
  });

  it("is forced modelled where the caller says a model carries it", () => {
    expect(derivedMarking(carried(false), true)?.kind).toBe("modelled");
  });
});
