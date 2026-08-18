import { describe, expect, it } from "vitest";
import { ToggleButton } from "./ToggleButton";
import { axe } from "./test/axe";
import { render, screen } from "./testing-react";

describe("ToggleButton", () => {
  it("reflects active into aria-pressed", () => {
    render(
      <ToggleButton active aria-label="prograde">
        PRO
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "prograde" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("forwards the data-failed convention attribute to the DOM (Ext-1)", () => {
    // Navball's SAS-mode buttons rely on this passthrough: a failed command's
    // control opts into the shared amber tint by setting data-failed, so the
    // attribute MUST reach the rendered <button>.
    render(
      <ToggleButton data-failed="true" aria-label="retrograde failed">
        RET
      </ToggleButton>,
    );
    expect(
      screen.getByRole("button", { name: "retrograde failed" }),
    ).toHaveAttribute("data-failed", "true");
  });

  it("has no axe violations in the failed state", async () => {
    const { container } = render(
      <ToggleButton data-failed="true" aria-label="retrograde failed, dismiss">
        RET
      </ToggleButton>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
