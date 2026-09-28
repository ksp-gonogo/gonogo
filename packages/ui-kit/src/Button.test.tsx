// An inline `<svg>` beside a word sits on the text baseline unless the button centres it, which no role query can see.
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Button, IconButton, TextButton } from "./Button";
import { CloseIcon, PlusIcon } from "./Icons";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

describe("a kit button carrying an icon and a word", () => {
  it("centres its children rather than sitting them on the text baseline", () => {
    render(
      <Button data-testid="compose">
        <PlusIcon size={14} />
        New message
      </Button>,
    );
    const style = getComputedStyle(screen.getByTestId("compose"));
    expect(style.display).toBe("inline-flex");
    expect(style.alignItems).toBe("center");
    // And a gap, so the glyph is not touching the first letter.
    expect(style.gap).not.toBe("");
    expect(style.gap).not.toBe("normal");
  });

  it("hands the same layout to the variants built on it", () => {
    // Variants share a bar with the base, so they must restyle colour only.
    render(
      <>
        <Button variant="ghost" data-testid="ghost">
          <PlusIcon size={14} />
          Ghost
        </Button>
        <Button variant="primary" data-testid="primary">
          <PlusIcon size={14} />
          Primary
        </Button>
      </>,
    );
    for (const id of ["ghost", "primary"]) {
      const style = getComputedStyle(screen.getByTestId(id));
      expect(style.display, id).toBe("inline-flex");
      expect(style.alignItems, id).toBe("center");
    }
  });
});

describe("the kit button family under keyboard focus", () => {
  it("draws the kit focus ring on every variant", () => {
    render(
      <>
        <Button>Base</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <TextButton>Text</TextButton>
        <IconButton aria-label="Close">
          <CloseIcon />
        </IconButton>
      </>,
    );
    for (const name of ["Base", "Primary", "Ghost", "Text", "Close"]) {
      const button = screen.getByRole("button", { name });
      expect(emittedStateRuleFor(button, ":focus-visible"), name).toContain(
        "outline:2px solid var(--color-focus)",
      );
    }
  });

  it("has no axe violations across the variants", async () => {
    const { container } = render(
      <>
        <Button>Base</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <TextButton>Text</TextButton>
        <IconButton aria-label="Close">
          <CloseIcon />
        </IconButton>
        <Button disabled>Disabled</Button>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});

describe("one button family: variant, tone and a single pressed look", () => {
  it("fills a primary button in go by default, under its own on-status text", () => {
    render(<Button variant="primary">Confirm</Button>);
    const rule = emittedRuleFor(
      screen.getByRole("button", { name: "Confirm" }),
    );
    expect(rule).toContain("background:var(--color-go-status)");
    expect(rule).toContain("color:var(--color-go-on-status)");
  });

  it("fills a destructive primary in nogo", () => {
    render(
      <Button variant="primary" tone="nogo">
        Delete
      </Button>,
    );
    const rule = emittedRuleFor(screen.getByRole("button", { name: "Delete" }));
    expect(rule).toContain("background:var(--color-nogo-status)");
    expect(rule).toContain("color:var(--color-nogo-on-status)");
  });

  it("edges a toned ghost in the tone's mark and words it in the tone's text", () => {
    render(
      <Button variant="ghost" tone="nogo">
        Abort
      </Button>,
    );
    const rule = emittedRuleFor(screen.getByRole("button", { name: "Abort" }));
    expect(rule).toContain("border-color:var(--color-nogo-mark)");
    expect(rule).toContain("color:var(--color-nogo-text)");
  });

  it("marks a pressed button with aria-pressed and the one pressed fill, whatever its variant", () => {
    render(
      <>
        <Button pressed>Default</Button>
        <Button variant="ghost" pressed>
          Ghost
        </Button>
        <Button pressed={false}>Released</Button>
      </>,
    );
    for (const name of ["Default", "Ghost"]) {
      const button = screen.getByRole("button", { name });
      expect(button, name).toHaveAttribute("aria-pressed", "true");
      expect(emittedRuleFor(button), name).toContain(
        "background:var(--color-go-status)",
      );
    }
    const released = screen.getByRole("button", { name: "Released" });
    expect(released).toHaveAttribute("aria-pressed", "false");
    expect(emittedRuleFor(released)).not.toContain("var(--color-go-status)");
  });

  it("leaves a button that is not a toggle without aria-pressed", () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("takes no alignment of its own", () => {
    render(<Button variant="primary">Save</Button>);
    expect(
      emittedRuleFor(screen.getByRole("button", { name: "Save" })),
    ).not.toContain("align-self");
  });
});

describe("the text button", () => {
  it("takes its colour and type from the words around it, and keeps the focus ring", () => {
    render(
      <Button variant="text" data-testid="name">
        Chutes
      </Button>,
    );
    const button = screen.getByTestId("name");
    const rule = emittedRuleFor(button);
    expect(rule).toContain("color:inherit");
    expect(rule).toContain("font:inherit");
    expect(emittedStateRuleFor(button, ":focus-visible")).toContain(
      "outline:2px solid var(--color-focus)",
    );
  });
});
