import { describe, expect, it } from "vitest";
import { Divider } from "./Divider";
import { render, screen } from "./testing-react";

describe("Divider", () => {
  it("renders an hr with the implicit separator role", () => {
    render(<Divider />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("accepts a space prop and still renders", () => {
    render(<Divider space="sm" data-testid="d" />);
    expect(screen.getByTestId("d").tagName).toBe("HR");
  });

  it("forwards attributes like aria-hidden", () => {
    render(<Divider aria-hidden="true" data-testid="d" />);
    expect(screen.getByTestId("d")).toHaveAttribute("aria-hidden", "true");
  });
});
