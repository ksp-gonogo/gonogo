import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Kerbin Explorer I</Card>);
    expect(screen.getByText("Kerbin Explorer I")).toBeInTheDocument();
  });

  it("forwards arbitrary div attributes", () => {
    render(<Card data-testid="vessel-card">Contents</Card>);
    expect(screen.getByTestId("vessel-card")).toHaveTextContent("Contents");
  });
});
