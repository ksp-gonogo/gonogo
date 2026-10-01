import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { FramedDisplay } from "./FramedDisplay";
import { Panel } from "./Panel";
import { Section } from "./Section";

/** Every styled-components rule the render injected, as one string. */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent)
    .join("\n");
}

describe("Panel filling section floor", () => {
  it("keeps a filling section above a minimum height instead of letting siblings squeeze it to nothing", () => {
    render(
      <Panel
        panelTitle="POWER"
        sections={[
          <Section key="a">totals</Section>,
          <Section key="b" fill>
            breakdown
          </Section>,
        ]}
      />,
    );
    expect(injectedCss()).toContain(
      "min-height:var(--size-section-fill-floor);",
    );
  });

  it("lets a lone framed drawing keep giving room back", () => {
    render(
      <Panel
        panelTitle="ORBIT"
        sections={
          <Section fill>
            <FramedDisplay>
              <svg aria-hidden="true" />
            </FramedDisplay>
          </Section>
        }
      />,
    );
    const body = document.querySelector("[data-panel-body]") as HTMLElement;
    expect(body).toHaveAttribute("data-panel-lone-frame");
    expect(injectedCss()).toMatch(
      /\[data-section-fill\]\{[^}]*min-height:0;[^}]*\}/,
    );
  });
});
