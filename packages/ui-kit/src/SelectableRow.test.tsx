import { describe, expect, it, vi } from "vitest";
import { SelectableRow } from "./SelectableRow";
import { fireEvent, render, screen } from "./testing-react";

describe("SelectableRow", () => {
  it("renders a real button carrying its children", () => {
    render(
      <SelectableRow selected={false}>
        <span>Servo A</span>
        <span>idle</span>
      </SelectableRow>,
    );
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Servo A");
    expect(row).toHaveTextContent("idle");
  });

  it("reflects selection through aria-pressed", () => {
    const { rerender } = render(
      <SelectableRow selected={false}>row</SelectableRow>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<SelectableRow selected>row</SelectableRow>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onClick when activated", () => {
    const onClick = vi.fn();
    render(
      <SelectableRow selected={false} onClick={onClick}>
        row
      </SelectableRow>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("forwards div/button attributes like aria-label", () => {
    render(
      <SelectableRow selected={false} aria-label="pick servo A">
        row
      </SelectableRow>,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "pick servo A",
    );
  });
});
