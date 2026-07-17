import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders a status role with the default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("accepts a custom aria label", () => {
    render(<Spinner ariaLabel="Arming" />);
    expect(screen.getByRole("status", { name: "Arming" })).toBeInTheDocument();
  });

  it("sizes itself from the size prop", () => {
    render(<Spinner size={24} />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "24px", height: "24px" });
  });

  it("defaults to a 12px size", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "12px", height: "12px" });
  });
});
