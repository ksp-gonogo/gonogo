import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("renders its words", () => {
    render(<Tag label="crew" />);
    expect(screen.getByText("crew")).toBeInTheDocument();
  });

  it("draws a symbol segment before the words and keeps it out of the accessible tree", () => {
    render(<Tag label="Alpha" symbol="+" />);
    const segment = screen.getByText("+").parentElement;
    expect(segment).toHaveAttribute("aria-hidden", "true");
    expect(segment?.nextSibling?.textContent).toBe("Alpha");
  });

  it("draws a name as written, not uppercase", () => {
    render(<Tag label="Alpha" name />);
    expect(getComputedStyle(screen.getByText("Alpha")).textTransform).not.toBe(
      "uppercase",
    );
  });

  it("forwards arbitrary attributes", () => {
    render(<Tag label="crew" title="a property" />);
    expect(screen.getByText("crew")).toHaveAttribute("title", "a property");
  });
});
