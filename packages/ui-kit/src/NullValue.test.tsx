import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY, NullValue } from "./NullValue";

describe("NULL_DISPLAY", () => {
  it("is a single em dash (U+2014)", () => {
    // Compared by code point, not by a literal em dash in this file, so
    // NullValue.tsx stays the ratchet's one and only allowed occurrence
    // (see packages/core/src/styleguide-emdash.test.ts).
    expect(NULL_DISPLAY).toHaveLength(1);
    expect(NULL_DISPLAY.codePointAt(0)).toBe(0x2014);
  });
});

describe("NullValue", () => {
  it("renders NULL_DISPLAY", () => {
    render(<NullValue />);
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("renders through Value's muted tone", () => {
    render(<NullValue />);
    const node = screen.getByText(NULL_DISPLAY);
    expect(node).toHaveStyle({ color: "var(--color-text-muted)" });
  });
});
