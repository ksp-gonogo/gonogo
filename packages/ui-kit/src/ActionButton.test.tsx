import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionButton } from "./ActionButton";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

describe("ActionButton", () => {
  it("renders its children as a real button", () => {
    render(<ActionButton>Deploy</ActionButton>);
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();
  });

  it("fires onClick when enabled", async () => {
    const onClick = vi.fn();
    render(<ActionButton onClick={onClick}>Deploy</ActionButton>);
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <ActionButton disabled onClick={onClick}>
        Deploy
      </ActionButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards disabled and aria-busy", () => {
    render(
      <ActionButton disabled aria-busy="true">
        Arming
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Arming" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("applies a different class for the go tone", () => {
    const { rerender } = render(
      <ActionButton tone="ghost">Confirm</ActionButton>,
    );
    const ghostClass = screen.getByRole("button", {
      name: "Confirm",
    }).className;
    rerender(<ActionButton tone="go">Confirm</ActionButton>);
    expect(screen.getByRole("button", { name: "Confirm" }).className).not.toBe(
      ghostClass,
    );
  });

  it("forwards the type attribute", () => {
    render(<ActionButton type="submit">Submit</ActionButton>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "type",
      "submit",
    );
  });
});

describe("ActionButton chrome", () => {
  it("draws the kit focus ring under keyboard focus", () => {
    render(<ActionButton>Deploy</ActionButton>);
    expect(
      emittedStateRuleFor(
        screen.getByRole("button", { name: "Deploy" }),
        ":focus-visible",
      ),
    ).toContain("outline:2px solid var(--color-focus)");
  });

  it("outlines the ghost tone in a border that shows on a panel", () => {
    render(<ActionButton>Deploy</ActionButton>);
    const rule = emittedRuleFor(screen.getByRole("button", { name: "Deploy" }));
    expect(rule).toContain("border:1px solid var(--color-border-strong)");
  });

  it("dims when disabled to the same strength as every other kit control", () => {
    render(<ActionButton disabled>Deploy</ActionButton>);
    expect(
      emittedStateRuleFor(
        screen.getByRole("button", { name: "Deploy" }),
        ":disabled",
      ),
    ).toContain("opacity:0.4");
  });
});
