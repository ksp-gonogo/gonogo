// An inline `<svg>` beside a word sits on the text baseline unless the button centres it, which no role query can see.
import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, TextButton } from "./Button";
import { CloseIcon, PlusIcon } from "./Icons";
import { Tooltip } from "./Tooltip";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

describe("a kit button carrying an icon and a word", () => {
  it("submits nothing inside a form unless it is asked to", () => {
    let submitted = 0;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted++;
        }}
      >
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Plain" }));
    expect(submitted).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submitted).toBe(1);
  });

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

describe("IconButton as a toggle", () => {
  it("takes the one pressed look while aria-pressed", () => {
    render(
      <IconButton aria-label="Alarm" aria-pressed>
        <CloseIcon />
      </IconButton>,
    );
    expect(
      emittedStateRuleFor(
        screen.getByRole("button", { name: "Alarm" }),
        '[aria-pressed="true"]',
      ),
    ).toContain("background:var(--color-go-status)");
  });
});

describe("the button tooltip rule", () => {
  const tipOf = (name: string) =>
    screen.getByRole("button", { name }).getAttribute("data-tooltip");

  it("tips the name of a button that is a glyph alone", () => {
    render(
      <>
        <IconButton aria-label="Close">
          <CloseIcon />
        </IconButton>
        <Button aria-label="Add a node">
          <PlusIcon />
        </Button>
      </>,
    );
    expect(tipOf("Close")).toBe("Close");
    expect(tipOf("Add a node")).toBe("Add a node");
  });

  it("tips the name of a button whose words do not fully say what it does", () => {
    render(<Button aria-label="Delete node 3">Delete</Button>);
    expect(tipOf("Delete node 3")).toBe("Delete node 3");
  });

  it("gives a button whose words are the whole story no tip", () => {
    render(
      <>
        <Button>Save</Button>
        <Button aria-label="Cancel">
          <span>Cancel</span>
        </Button>
      </>,
    );
    expect(tipOf("Save")).toBeNull();
    expect(tipOf("Cancel")).toBeNull();
  });

  it("does not tip twice when an enclosing Tooltip already has", () => {
    render(
      <Tooltip text="Closes the panel">
        <IconButton aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Tooltip>,
    );
    expect(tipOf("Close")).toBe("Closes the panel");
  });

  it("says why a disabled button is disabled, and keeps it focusable with presses doing nothing", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled disabledReason="No vessel is loaded" onClick={onClick}>
        Fly
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Fly" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button.getAttribute("data-tooltip")).toBe("No vessel is loaded");
    expect(button).toHaveAccessibleDescription("No vessel is loaded");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    button.focus();
    expect(button).toHaveFocus();
  });

  it("puts the name before the reason for a disabled glyph", () => {
    render(
      <IconButton aria-label="Undo" disabled disabledReason="Nothing to undo">
        <CloseIcon />
      </IconButton>,
    );
    expect(tipOf("Undo")).toBe("Undo: Nothing to undo");
  });

  it("keeps a disabled button with no reason natively disabled", () => {
    render(<Button disabled>Fly</Button>);
    expect(screen.getByRole("button", { name: "Fly" })).toBeDisabled();
  });

  it("submits no form from a button disabled with a reason", () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) =>
      e.preventDefault(),
    );
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled disabledReason="Nothing to send">
          Send
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("a button showing a held state", () => {
  const heldMarking = {
    kind: "held" as const,
    caption: "Last known state. The press sends the opposite.",
  };

  it("stays pressable, draws the kit's held mark and says what it means", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button marked={heldMarking} onClick={onClick}>
        SAS ON
      </Button>,
    );
    const button = screen.getByRole("button", { name: /SAS ON/ });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button.querySelector("[data-held-mark]")).not.toBeNull();
    expect(button).toHaveTextContent(heldMarking.caption);
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds nothing to a button that is not marked", () => {
    render(<Button marked={null}>SAS ON</Button>);
    const button = screen.getByRole("button", { name: "SAS ON" });
    expect(button.querySelector("[data-held-mark]")).toBeNull();
  });
});
