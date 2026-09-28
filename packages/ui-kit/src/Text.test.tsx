import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Text } from "./Text";

describe("Value", () => {
  it("maps each tone to its text role token", () => {
    render(
      <Text tone="go" data-testid="v">
        GO
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-go-text)",
    });
  });

  it("maps warn/nogo/info tones too", () => {
    const { rerender } = render(
      <Text tone="warn" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-warn-text)",
    });
    rerender(
      <Text tone="nogo" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-nogo-text)",
    });
    rerender(
      <Text tone="info" data-testid="v">
        x
      </Text>,
    );
    expect(screen.getByTestId("v")).toHaveStyle({
      color: "var(--color-info-text)",
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

  it("draws in the neutral text colour unless a caller chooses a tone", () => {
    render(<Text data-testid="plain">Kerbin</Text>);
    expect(screen.getByTestId("plain")).toHaveStyle({
      color: "var(--color-neutral-text)",
    });
  });

  it("recedes neutral text to the level asked for", () => {
    render(
      <Text level="faint" data-testid="faint">
        echo
      </Text>,
    );
    expect(screen.getByTestId("faint")).toHaveStyle({
      color: "var(--color-text-faint)",
    });
  });

  it("keeps a tone's colour over a level, so a state is never dimmed away", () => {
    render(
      <Text tone="nogo" level="faint" data-testid="alarm">
        ABORT
      </Text>,
    );
    expect(screen.getByTestId("alarm")).toHaveStyle({
      color: "var(--color-nogo-text)",
    });
  });
});
