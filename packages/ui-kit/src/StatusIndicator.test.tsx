import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIndicator } from "./StatusIndicator";

describe("StatusIndicator", () => {
  it("renders its label text", () => {
    render(<StatusIndicator tone="go">Connected</StatusIndicator>);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("is not a live region by default", () => {
    render(<StatusIndicator tone="neutral">Idle</StatusIndicator>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("becomes a polite live region when live is set", () => {
    render(
      <StatusIndicator tone="nogo" live>
        Disconnected
      </StatusIndicator>,
    );
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveTextContent("Disconnected");
  });

  it("applies a different class for different tones", () => {
    const { rerender } = render(
      <StatusIndicator tone="neutral">State</StatusIndicator>,
    );
    const neutralClass = screen.getByText("State").parentElement?.className;
    rerender(<StatusIndicator tone="warn">State</StatusIndicator>);
    expect(screen.getByText("State").parentElement?.className).not.toBe(
      neutralClass,
    );
  });
});
