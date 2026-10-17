import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ContainerBreak } from "./ContainerBreak";

/** Every styled-components rule the render injected, as one string. */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent)
    .join("\n");
}

describe("ContainerBreak", () => {
  it("switches at an aspect ratio of a container sized in both axes", () => {
    render(
      <ContainerBreak atAspect={2.5} wide={{ display: "grid" }}>
        x
      </ContainerBreak>,
    );
    expect(injectedCss()).toMatch(/@container \(aspect-ratio >= 2\.5\)/);
  });

  it("needs both breakpoints when given both", () => {
    render(
      <ContainerBreak at={300} atAspect={2} wide={{ display: "grid" }}>
        x
      </ContainerBreak>,
    );
    expect(injectedCss()).toMatch(
      /@container \(min-width: 300px\) and \(aspect-ratio >= 2\)/,
    );
  });
});
