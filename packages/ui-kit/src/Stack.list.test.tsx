import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Section } from "./Section";
import { Stack } from "./Stack";
import { emittedStateRuleFor } from "./test/emittedRule";

/**
 * A list-typed Stack is a layout box first. The browser gives a `ul` a 40px
 * indent, a block margin and bullets, which indented and pushed down a whole
 * panel sidebar before this reset existed.
 */
describe("Stack rendered as a list", () => {
  for (const tag of ["ul", "ol"] as const) {
    it(`drops the browser's indent, margin and bullets on a ${tag}`, () => {
      render(
        <Stack as={tag} data-testid="list">
          <li>one</li>
        </Stack>,
      );
      const list = screen.getByTestId("list");
      expect(list.tagName.toLowerCase()).toBe(tag);
      const rule = emittedStateRuleFor(list, ":where(");
      expect(rule).toContain("margin:0");
      expect(rule).toContain("padding:0");
      expect(rule).toContain("list-style:none");
    });
  }

  it("resets a list-typed Section the same way, since it is a Stack", () => {
    render(
      <Section as="ul" data-testid="list">
        <li>one</li>
      </Section>,
    );
    expect(
      emittedStateRuleFor(screen.getByTestId("list"), ":where("),
    ).toContain("padding:0");
  });
});
