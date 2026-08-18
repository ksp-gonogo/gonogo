import { describe, expect, it } from "vitest";
import { StatusIndicator } from "./StatusIndicator";
import { render, screen } from "./testing-react";

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

  it("pulses the dot when pulse is set, and slow/fast differ", () => {
    const { container, rerender } = render(
      <StatusIndicator tone="go">Live</StatusIndicator>,
    );
    const dotClass = () =>
      container.querySelector('span[aria-hidden="true"]')?.className;
    const staticClass = dotClass();
    rerender(
      <StatusIndicator tone="go" pulse="fast">
        Live
      </StatusIndicator>,
    );
    const fastClass = dotClass();
    expect(fastClass).not.toBe(staticClass);
    rerender(
      <StatusIndicator tone="go" pulse="slow">
        Live
      </StatusIndicator>,
    );
    expect(dotClass()).not.toBe(fastClass);
  });
});
