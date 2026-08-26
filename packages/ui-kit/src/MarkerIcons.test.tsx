import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  AntiNormalIcon,
  AntiTargetIcon,
  MARKER_ICONS,
  MARKER_IDS,
  ManeuverIcon,
  NormalIcon,
  ParallelMinusIcon,
  ParallelPlusIcon,
  ProgradeIcon,
  RadialInIcon,
  RadialOutIcon,
  RelativeMinusIcon,
  RelativePlusIcon,
  RetrogradeIcon,
  TargetIcon,
} from "./MarkerIcons";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The svg's markup with every colour reference removed: what a greyscale reader is left with. */
function silhouette(svg: Element): string {
  return svg.outerHTML
    .replace(/var\(--color-marker-[a-z]+\)/g, "")
    .replace(/currentColor/g, "")
    .replace(/data-marker="[^"]*"/g, "");
}

describe("MarkerIcons", () => {
  it("is decorative by default: hidden from assistive technology, no role", () => {
    const { container } = render(<ProgradeIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-label");
  });

  it("becomes a named image when given a label", () => {
    render(<RetrogradeIcon label="Retrograde" />);
    const svg = screen.getByRole("img", { name: "Retrograde" });
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("draws at the kit's 20px default and honours size", () => {
    const { container } = render(
      <>
        <NormalIcon />
        <NormalIcon size={48} data-testid="big" />
      </>,
    );
    const [small] = container.querySelectorAll("svg");
    expect(small).toHaveAttribute("width", "20");
    expect(small).toHaveAttribute("viewBox", "0 0 24 24");
    expect(screen.getByTestId("big")).toHaveAttribute("height", "48");
  });

  it("has no axe violations, decorative and named alike", async () => {
    const { container } = render(
      <>
        {MARKER_IDS.map((id) => {
          const Icon = MARKER_ICONS[id];
          return <Icon key={id} />;
        })}
        {MARKER_IDS.map((id) => {
          const Icon = MARKER_ICONS[id];
          return <Icon key={id} label={id} />;
        })}
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("every marker has a distinct silhouette once colour is stripped", () => {
    const { container } = render(
      <>
        {MARKER_IDS.map((id) => {
          const Icon = MARKER_ICONS[id];
          return <Icon key={id} />;
        })}
      </>,
    );
    const shapes = [...container.querySelectorAll("svg")].map(silhouette);
    expect(new Set(shapes).size).toBe(MARKER_IDS.length);
  });

  it.each([
    ["prograde/retrograde", ProgradeIcon, RetrogradeIcon],
    ["normal/anti-normal", NormalIcon, AntiNormalIcon],
    ["radial out/in", RadialOutIcon, RadialInIcon],
    ["target/anti-target", TargetIcon, AntiTargetIcon],
    ["relative +/-", RelativePlusIcon, RelativeMinusIcon],
    ["parallel +/-", ParallelPlusIcon, ParallelMinusIcon],
  ])("the %s pair shares a hue and is told apart by dot versus cross", (_pair, Positive, Negative) => {
    const { container } = render(
      <>
        <Positive />
        <Negative />
      </>,
    );
    const [pos, neg] = container.querySelectorAll("svg");
    const hue = (svg: Element) =>
      svg.outerHTML.match(/var\(--color-marker-[a-z]+\)/)?.[0];
    expect(hue(pos)).toBe(hue(neg));
    expect(pos.querySelector("circle")).not.toBeNull();
    expect(neg.querySelector("circle")).toBeNull();
  });

  it("covers every SmartASS direction, and the data-driven map covers every id", () => {
    expect(MARKER_IDS).toEqual([
      "prograde",
      "retrograde",
      "normal",
      "antiNormal",
      "radialOut",
      "radialIn",
      "maneuver",
      "target",
      "antiTarget",
      "relativePlus",
      "relativeMinus",
      "parallelPlus",
      "parallelMinus",
    ]);
    expect(Object.keys(MARKER_ICONS).sort()).toEqual([...MARKER_IDS].sort());
  });

  it("draws every target-frame direction in the target hue, as the game does for relative velocity", () => {
    const { container } = render(
      <>
        <TargetIcon />
        <RelativePlusIcon />
        <RelativeMinusIcon />
        <ParallelPlusIcon />
        <ParallelMinusIcon />
      </>,
    );
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.outerHTML).toContain("var(--color-marker-target)");
      expect(svg.outerHTML).not.toContain("var(--color-marker-prograde)");
    }
  });

  it("references only marker tokens the theme defines", () => {
    const tokens = readFileSync(
      resolve(HERE, "../../theme/src/tokens.css"),
      "utf8",
    );
    const { container } = render(
      <>
        {MARKER_IDS.map((id) => {
          const Icon = MARKER_ICONS[id];
          return <Icon key={id} />;
        })}
        <ManeuverIcon />
      </>,
    );
    const referenced = new Set(
      container.innerHTML.match(/--color-marker-[a-z]+/g) ?? [],
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const token of referenced) {
      expect(tokens, `${token} missing from tokens.css`).toContain(`${token}:`);
    }
  });
});
