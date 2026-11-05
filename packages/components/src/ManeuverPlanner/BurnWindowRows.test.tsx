import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { BurnWindowRows } from "./BurnWindowRows";

describe("BurnWindowRows", () => {
  it("states no time-to-burn while the view clock is unknown", () => {
    render(<BurnWindowRows burn={{ ut: 1000 }} nowUt={undefined} />);
    expect(screen.queryByText(/^(in|ago)\b/)).toBeNull();
    expect(screen.queryByText(/\bago$/)).toBeNull();
    expect(
      document.querySelector("[data-burn-instant-row]")?.textContent,
    ).toContain(NULL_DISPLAY);
  });

  it("keeps each instant's label and time in one label and reading line", () => {
    render(<BurnWindowRows burn={{ ut: 1000 }} nowUt={900} />);
    const lines = [
      ...document.querySelectorAll("[data-burn-instant-row] > div"),
    ].map((l) => l.textContent ?? "");
    expect(lines).toHaveLength(3);
    // The label and its time are one element's text, so a wide tile cannot pull them apart.
    expect(lines.some((t) => /in \d/.test(t))).toBe(true);
  });
});
