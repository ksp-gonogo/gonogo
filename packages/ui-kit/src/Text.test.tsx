import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Text } from "./Text";

describe("Value", () => {
  it("maps status tones to their fg tokens", () => {
    render(
      <Text tone="go" data-testid="v">
        GO
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-go-fg)",
    });
  });

  it("maps warn/nogo/info tones too", () => {
    const { rerender } = render(
      <Text tone="warn" data-testid="v">
        x
      </Text>,
    );
    // The MUTED amber, and it has to be: the plain warning foreground is a
    // near-black meant for text sitting on the amber badge, so a warning
    // SENTENCE painted with it disappears into the panel behind it.
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-warning-fg-muted)",
    });
    rerender(
      <Text tone="nogo" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-nogo-fg)",
    });
    rerender(
      <Text tone="info" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-status-info-fg)",
    });
  });

  it("applies semibold weight when set, inherits otherwise", () => {
    const { rerender } = render(
      <Text weight="semibold" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({ fontWeight: "600" });
    rerender(<Text data-testid="v">x</Text>);
    expect(screen.getByTestId("v")).not.toHaveStyle({ fontWeight: "600" });
  });
});
