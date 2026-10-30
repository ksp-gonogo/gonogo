import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TechGraph } from "./TechGraph";
import type { TechNode } from "./wire";

const node = (id: string, state: TechNode["state"]): TechNode => ({
  id,
  title: `Title ${id}`,
  description: "",
  scienceCost: 45,
  state,
  parents: [],
  parts: [],
});

function mount(state: TechNode["state"]) {
  render(
    <TechGraph
      nodes={[node("a", state)]}
      tiers={new Map([["a", 0]])}
      researchable={new Set()}
      dimmed={() => false}
      selectedId={null}
      onSelect={() => {}}
    />,
  );
  return screen.getByText("Title a");
}

function rulesFor(el: HTMLElement): string {
  const classes = [...el.classList];
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((c) => text.includes(`.${c}`)))
    .join("\n");
}

describe("graph card title", () => {
  it.each([
    "Unavailable",
    "Available",
  ] as const)("keeps the corner mark's room beside the first line only on a %s card", (state) => {
    const title = mount(state);
    expect(getComputedStyle(title).paddingRight).not.toMatch(/[1-9]/);
    expect(rulesFor(title)).toMatch(/::before[^}]*float:\s*right/);
  });
});
