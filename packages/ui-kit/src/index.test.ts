import { describe, expect, it } from "vitest";
import { defaultDarkTheme, GonogoTokens } from "./index";

describe("ui-kit foundation", () => {
  it("exports a default-dark theme satisfying the token contract", () => {
    expect(defaultDarkTheme.colors.text.primary).toBe(
      "var(--color-text-primary)",
    );
    expect(defaultDarkTheme.colors.accent.fg).toBe("var(--color-accent-fg)");
    expect(defaultDarkTheme.colors.focus).toBe("var(--color-focus)");
  });

  it("carries the extended token scales the primitives depend on", () => {
    expect(defaultDarkTheme.typography.letterSpacing.tight).toBe("0.05em");
    expect(defaultDarkTheme.typography.letterSpacing.label).toBe("0.1em");
    expect(defaultDarkTheme.typography.letterSpacing.wide).toBe("0.15em");
    expect(defaultDarkTheme.radii.xs).toBe("2px");
    expect(defaultDarkTheme.radii.pill).toBe("999px");
  });

  it("exports GonogoTokens as a styled-components global sheet", () => {
    expect(GonogoTokens).toBeTypeOf("object");
  });
});
