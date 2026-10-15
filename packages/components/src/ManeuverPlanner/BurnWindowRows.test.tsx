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
});
