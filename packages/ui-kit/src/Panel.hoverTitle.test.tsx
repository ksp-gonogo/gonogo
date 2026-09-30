import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel } from "./Panel";
import { Section } from "./Section";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

/**
 * The reveal rule for `selector` (":hover" or ":focus") on `heading`'s own
 * generated class, ancestored under `panel`'s: the shape styled-components
 * compiles `${PanelContainer}:hover &` to, which is the reverse nesting of
 * `emittedStateRuleFor` (that helper reads a state on the element's OWN
 * class, not an ancestor's). An interpolated `${Component}` reference
 * compiles to the STABLE `sc-` class, not the dynamic one `emittedRuleFor`
 * matches on, so the two helpers key off different classes. `undefined` when
 * no such rule was emitted.
 */
function revealRuleFor(
  panel: HTMLElement,
  heading: HTMLElement,
  selector: string,
): string | undefined {
  const panelClass = Array.from(panel.classList).find((c) =>
    c.startsWith("sc-"),
  );
  const headingClasses = Array.from(heading.classList).filter(
    (c) => !c.startsWith("sc-"),
  );
  if (!panelClass || headingClasses.length === 0) {
    throw new Error("no generated class on the panel or the heading");
  }
  const sheet = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("");
  const needle = `.${panelClass}${selector}`;
  for (
    let at = sheet.indexOf(needle);
    at !== -1;
    at = sheet.indexOf(needle, at + 1)
  ) {
    const close = sheet.indexOf("{", at);
    const between = sheet.slice(at + needle.length, close);
    if (!headingClasses.some((c) => between.includes(`.${c}`))) continue;
    return sheet.slice(at, sheet.indexOf("}", close) + 1);
  }
  return undefined;
}

describe("Panel hoverTitle: the tiny tile's header out of flow", () => {
  it("has no header row in the flow, and keeps the delay rail's reserved band", () => {
    const { container } = render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    expect(container.querySelector("[data-panel-header]")).toBeNull();
    expect(container.querySelector("[data-panel-sticky-top]")).not.toBeNull();
    expect(container.querySelector("[data-panel-rail-frame]")).not.toBeNull();
  });

  it("is a focusable group named by its sr-only heading through aria-labelledby, not a repeated aria-label", () => {
    render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    const panel = screen.getByRole("group", { name: "TWR" });
    expect(panel).toHaveAttribute("tabindex", "0");
    expect(panel).not.toHaveAttribute("aria-label");
    const heading = screen.getByRole("heading", { level: 3, name: "TWR" });
    expect(panel.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
  });

  it("keeps the heading sr-only at rest", () => {
    render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 3 });
    expect(getComputedStyle(heading).position).toBe("absolute");
  });

  it("reveals the heading as a pill on hover of the panel, and again on focus, not on either alone at rest", () => {
    const { container } = render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    const panel = container.firstElementChild as HTMLElement;
    const heading = screen.getByRole("heading", { level: 3 });
    for (const selector of [":hover", ":focus"]) {
      const rule = revealRuleFor(panel, heading, selector);
      expect(rule, selector).toBeDefined();
      expect(rule, selector).toContain("position:static");
    }
    // Never on the browser's own focus-visible heuristic alone: a tap must reveal it too.
    expect(revealRuleFor(panel, heading, ":focus-visible")).toBeUndefined();
  });

  it("draws its own focus ring inside its edge, since the grid cell clips an outset one", () => {
    const { container } = render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    const panel = container.firstElementChild as HTMLElement;
    const rule = emittedStateRuleFor(panel, ":focus-visible");
    expect(rule).toBeDefined();
    expect(rule).toContain("outline-offset:-2px");
  });

  it("keeps the header aside (the status summary) drawn, pinned top-right", () => {
    const { container } = render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        panelAside={<Badge>WARN</Badge>}
        sections={<Section full>1.8</Section>}
      />,
    );
    const overlay = container.querySelector("[data-panel-hover-title]");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("WARN");
  });

  it("insets the body by the shared tiny-inset token, not a raw length", () => {
    const { container } = render(
      <Panel
        panelTitle="TWR"
        fitToSize
        hoverTitle
        sections={<Section full>1.8</Section>}
      />,
    );
    const body = container.querySelector("[data-panel-body]") as HTMLElement;
    const rule = emittedRuleFor(body);
    expect(rule).toContain("--panel-body-gutter:var(--inset-tiny)");
    expect(rule).toContain("--panel-body-bottom:var(--inset-tiny)");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Panel
        panelTitle="COMMNET"
        fitToSize
        hoverTitle
        panelAside={<Badge>LOS</Badge>}
        sections={<Section full>62%</Section>}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
