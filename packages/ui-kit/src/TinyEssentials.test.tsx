import {
  type ComponentDefinition,
  type Reading,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import {
  showsTiny,
  smallestBodyTile,
  TinyEssentials,
  WidgetBody,
} from "./TinyEssentials";

const held: Reading<Value<"m">> = {
  state: "stale",
  reckoning: { status: "none" },
  value: value("m", 1200),
  asOfUt: value("ut", 100),
  grade: "held-stale",
};

const ESSENTIALS: readonly TinyEssential[] = [
  { label: "Alt", value: value("m", 1200) },
  { label: "V/S", value: value("m/s", -12) },
];

function widget(tiny?: ComponentDefinition["tiny"]): ComponentDefinition {
  return {
    id: "tiny-test",
    name: "Tiny test",
    description: "",
    tags: [],
    component: () => <p>the body</p>,
    tiny,
  };
}

describe("WidgetBody", () => {
  const tiny = {
    title: "TEST",
    useEssentials: () => ESSENTIALS,
  };

  it("draws the kit's tiny form in the tiny bucket and the body above it", () => {
    const { unmount } = render(
      <WidgetBody def={widget(tiny)} id="t" w={4} h={6} />,
    );
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.queryByText("the body")).toBeNull();
    unmount();

    render(<WidgetBody def={widget(tiny)} id="t" w={5} h={4} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("draws the body at every size when the widget declares no tiny mode", () => {
    render(<WidgetBody def={widget()} id="t" w={2} h={2} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("draws the body before the grid has measured", () => {
    render(<WidgetBody def={widget(tiny)} id="t" />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("switches at the body's own floor where one is declared", () => {
    const floored = { ...tiny, bodyMinSize: { w: 7, h: 9 } };
    expect(showsTiny(floored, 6, 20)).toBe(true);
    expect(showsTiny(floored, 12, 8)).toBe(true);
    expect(showsTiny(floored, 7, 9)).toBe(false);
  });
});

describe("smallestBodyTile", () => {
  it("is the body's floor, or the tiny bucket's edge, never below minSize", () => {
    const tiny = { title: "T", useEssentials: () => [] };
    expect(smallestBodyTile(tiny, { w: 3, h: 3 })).toEqual({ w: 5, h: 4 });
    expect(smallestBodyTile(tiny, { w: 6, h: 2 })).toEqual({ w: 6, h: 4 });
    expect(
      smallestBodyTile(
        { ...tiny, bodyMinSize: { w: 7, h: 9 } },
        { w: 3, h: 4 },
      ),
    ).toEqual({ w: 7, h: 9 });
  });
});

describe("TinyEssentials", () => {
  it("pairs each figure with its label, the first as the hero", async () => {
    const { container } = render(
      <TinyEssentials title="LANDING" essentials={ESSENTIALS} />,
    );
    const terms = [...container.querySelectorAll("dt")].map(
      (d) => d.textContent,
    );
    expect(terms).toEqual(["Alt", "V/S"]);
    expect(container.querySelectorAll("[data-tiny-essential]")).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it("keeps a lone figure's caption for the ear only when the heading already names it", () => {
    const { container, unmount } = render(
      <TinyEssentials
        title="TWR"
        essentials={[{ label: "TWR", value: value("1", 1.4) }]}
      />,
    );
    const term = container.querySelector("dt");
    expect(term?.textContent).toBe("TWR");
    expect(getComputedStyle(term as Element).position).toBe("absolute");
    unmount();

    const { container: named } = render(
      <TinyEssentials
        title="CREW"
        essentials={[{ label: "Aboard", value: value("count", 3) }]}
      />,
    );
    expect(
      getComputedStyle(named.querySelector("dt") as Element).position,
    ).not.toBe("absolute");
  });

  it("marks a held reading and draws the null token for a missing one", () => {
    const { container } = render(
      <TinyEssentials
        title="T"
        essentials={[
          { label: "Alt", value: held },
          { label: "V/S", value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(1);
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("draws a declared level glyph beside the figure, named by its label", () => {
    render(
      <TinyEssentials
        title="COMMNET"
        essentials={[
          {
            label: "Signal",
            value: value("ratio", 0.62),
            level: { lit: 3, of: 4 },
            tone: "go",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Signal 3 of 4" }),
    ).toBeInTheDocument();
  });
});
