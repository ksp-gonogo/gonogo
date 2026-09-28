import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ToggleButton } from "./ToggleButton";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

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
    // A failed command's control opts into the shared amber tint through data-failed, so it must reach the <button>.
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
    await expectNoA11yViolations(container);
  });
});

describe("ToggleButton data-failed tint", () => {
  it("draws its label in the warning colour made for text on a dark ground", () => {
    render(
      <ToggleButton active={false} data-failed="true">
        RCS
      </ToggleButton>,
    );
    const rule = emittedStateRuleFor(
      screen.getByRole("button", { name: "RCS" }),
      '[data-failed="true"]',
    );
    expect(rule).toContain("var(--color-warn-text)");
  });
});

describe("ToggleButton draws with the kit's Button", () => {
  it("fills in its tone only while active", () => {
    render(
      <>
        <ToggleButton tone="nogo" active>
          On
        </ToggleButton>
        <ToggleButton tone="nogo">Off</ToggleButton>
      </>,
    );
    expect(
      emittedRuleFor(screen.getByRole("button", { name: "On" })),
    ).toContain("background:var(--color-nogo-status)");
    const off = emittedRuleFor(screen.getByRole("button", { name: "Off" }));
    expect(off).not.toContain("nogo");
  });

  it("fills in go by default", () => {
    render(<ToggleButton active>SAS</ToggleButton>);
    expect(
      emittedRuleFor(screen.getByRole("button", { name: "SAS" })),
    ).toContain("background:var(--color-go-status)");
  });
});
