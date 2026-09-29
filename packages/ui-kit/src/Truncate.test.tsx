import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Truncate } from "./Truncate";
import { emittedRuleFor } from "./test/emittedRule";

describe("Truncate", () => {
  it("draws in its own theme text colour, so no ancestor's default can reach its words", () => {
    render(<Truncate data-testid="t">Chutes</Truncate>);
    expect(emittedRuleFor(screen.getByTestId("t"))).toContain(
      "color:var(--color-neutral-text)",
    );
  });
});
