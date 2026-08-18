import { describe, expect, it } from "vitest";
import { render, screen } from "./testing-react";
import { Value } from "./Value";

describe("Value", () => {
  it("maps status tones to their fg tokens", () => {
    render(
      <Value tone="go" data-testid="v">
        GO
      </Value>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-go-fg)",
    });
  });

  it("maps warn/nogo/info tones too", () => {
    const { rerender } = render(
      <Value tone="warn" data-testid="v">
        x
      </Value>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-warning-fg)",
    });
    rerender(
      <Value tone="nogo" data-testid="v">
        x
      </Value>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-nogo-fg)",
    });
    rerender(
      <Value tone="info" data-testid="v">
        x
      </Value>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-info-fg)",
    });
  });

  it("applies semibold weight when set, inherits otherwise", () => {
    const { rerender } = render(
      <Value weight="semibold" data-testid="v">
        x
      </Value>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({ fontWeight: "600" });
    rerender(<Value data-testid="v">x</Value>);
    expect(screen.getByTestId("v")).not.toHaveStyle({ fontWeight: "600" });
  });
});
