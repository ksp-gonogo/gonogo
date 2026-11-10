import { act, render, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FOCUS_RESTORE_ATTRIBUTE } from "./focusRestore";
import { HeldFigure } from "./HeldMark";
import { Tooltip, useTooltip } from "./Tooltip";

function Anchored({ text }: { text: string | null }) {
  const { anchor, tip } = useTooltip(text);
  return (
    <span data-testid="anchor" {...anchor}>
      42 km{tip}
    </span>
  );
}

/** Points at an element and keeps the pointer there past the open delay. */
async function restOn(
  user: ReturnType<typeof userEvent.setup>,
  element: Element,
): Promise<void> {
  await user.hover(element);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
}

const tipIn = (root: ParentNode) =>
  root.querySelector<HTMLElement>("[data-tooltip-tip]");

describe("useTooltip", () => {
  it("opens the tip on the document body while the pointer is over the anchor", async () => {
    const user = userEvent.setup();
    const { container } = render(<Anchored text="Held since Y1 D12" />);
    const anchor = screen.getByTestId("anchor");
    expect(tipIn(document.body)).toBeNull();

    await restOn(user, anchor);
    const tip = tipIn(document.body);
    expect(tip).toHaveTextContent("Held since Y1 D12");
    expect(tip).toHaveAttribute("aria-hidden", "true");
    expect(container.contains(tip)).toBe(false);

    await user.unhover(anchor);
    await waitFor(() => expect(tipIn(document.body)).toBeNull());
  });

  it("opens only once the pointer has rested on the anchor, and not at all for a pass-through", async () => {
    const user = userEvent.setup();
    render(<Anchored text="Held since Y1 D12" />);
    const anchor = screen.getByTestId("anchor");
    await user.hover(anchor);
    expect(tipIn(document.body)).toBeNull();
    await user.unhover(anchor);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(tipIn(document.body)).toBeNull();

    await restOn(user, anchor);
    expect(tipIn(document.body)).not.toBeNull();
  });

  it("opens the tip on keyboard focus and closes it on blur", async () => {
    const user = userEvent.setup();
    function Focusable() {
      const { anchor, tip } = useTooltip("Two\nlines");
      return (
        <button type="button" {...anchor}>
          Send{tip}
        </button>
      );
    }
    render(<Focusable />);
    await user.tab();
    expect(tipIn(document.body)).toHaveTextContent("Two lines");
    await user.tab();
    expect(tipIn(document.body)).toBeNull();
  });

  it("leaves an anchor with nothing to say inert", async () => {
    const user = userEvent.setup();
    render(<Anchored text={null} />);
    const anchor = screen.getByTestId("anchor");
    expect(anchor).not.toHaveAttribute("data-tooltip");
    await restOn(user, anchor);
    expect(tipIn(document.body)).toBeNull();
  });
});

describe("HeldFigure", () => {
  it("speaks its caption, marks the figure, and shows the caption as the kit tip rather than a native title", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HeldFigure caption="held, as of Y1 D12">12:00</HeldFigure>,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host).not.toHaveAttribute("title");
    expect(host.querySelector("[data-held-mark]")).not.toBeNull();
    expect(host).toHaveTextContent("12:00, held, as of Y1 D12");

    await restOn(user, host);
    expect(tipIn(document.body)).toHaveTextContent("held, as of Y1 D12");
  });
});

describe("Tooltip", () => {
  it("describes a button by its text without a native title, on hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Saves the game first">
        <button type="button">Leave</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Leave" });
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAttribute("aria-description", "Saves the game first");
    expect(tipIn(document.body)).toBeNull();

    await restOn(user, button);
    expect(tipIn(document.body)).toHaveTextContent("Saves the game first");
    await user.unhover(button);
    await waitFor(() => expect(tipIn(document.body)).toBeNull());
  });

  it("stands above an anchor that asks for it, and below one too near the top", async () => {
    const user = userEvent.setup();
    const rectAt = (top: number) =>
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        top,
        bottom: top + 18,
        left: 10,
        right: 60,
        width: 50,
        height: 18,
        x: 10,
        y: top,
        toJSON: () => ({}),
      });
    const spy = rectAt(200);
    const { unmount } = render(
      <Tooltip text="Drag to reposition" placement="above">
        <button type="button">Grip</button>
      </Tooltip>,
    );
    await restOn(user, screen.getByRole("button", { name: "Grip" }));
    expect(tipIn(document.body)).toHaveAttribute("data-above");
    unmount();
    spy.mockRestore();

    const near = rectAt(10);
    render(
      <Tooltip text="Drag to reposition" placement="above">
        <button type="button">Grip</button>
      </Tooltip>,
    );
    await restOn(user, screen.getByRole("button", { name: "Grip" }));
    expect(tipIn(document.body)).not.toHaveAttribute("data-above");
    near.mockRestore();
  });

  it("opens for keyboard focus and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Pause the warp">
        <button type="button">Warp</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Warp" })).toHaveFocus();
    expect(tipIn(document.body)).toHaveTextContent("Pause the warp");

    await user.keyboard("{Escape}");
    expect(tipIn(document.body)).toBeNull();
  });

  it("lets the pointer move onto the tip, which stays open while hovered", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Held since Y1 D12">
        <span data-testid="anchor">Alt</span>
      </Tooltip>,
    );
    await restOn(user, screen.getByTestId("anchor"));
    const tip = tipIn(document.body) as HTMLElement;
    expect(getComputedStyle(tip).pointerEvents).not.toBe("none");

    await restOn(user, tip);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(tipIn(document.body)).toBe(tip);

    await user.unhover(tip);
    await waitFor(() => expect(tipIn(document.body)).toBeNull());
  });

  it("closes when the anchor is pressed, so a leave after the press has no timer left to run", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Add widget">
        <button type="button">Add</button>
      </Tooltip>,
    );
    await restOn(user, screen.getByRole("button", { name: "Add" }));
    expect(tipIn(document.body)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(tipIn(document.body)).toBeNull();

    await user.unhover(screen.getByRole("button", { name: "Add" }));
    expect(tipIn(document.body)).toBeNull();
  });

  it("closes on Escape from the window while only the pointer is over the anchor", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Held since Y1 D12">
        <span data-testid="anchor">Alt</span>
      </Tooltip>,
    );
    await restOn(user, screen.getByTestId("anchor"));
    expect(tipIn(document.body)).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(tipIn(document.body)).toBeNull();
  });

  describe("selecting the tip's text", () => {
    function open() {
      const user = userEvent.setup();
      const { container } = render(
        <Tooltip text="Held since Y1 D12">
          <span data-testid="anchor">Alt</span>
        </Tooltip>,
      );
      return { user, container };
    }
    const selectTipText = () => {
      const tip = tipIn(document.body) as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(tip);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it("stays open when the press lands in the tip, instead of closing as a press on the anchor does", async () => {
      const { user } = open();
      await restOn(user, screen.getByTestId("anchor"));
      await user.pointer({
        target: tipIn(document.body) as HTMLElement,
        keys: "[MouseLeft>]",
      });
      expect(tipIn(document.body)).not.toBeNull();
    });

    it("stays open while a drag carries the pointer off the tip, and while its text is selected afterwards", async () => {
      const { user } = open();
      await restOn(user, screen.getByTestId("anchor"));
      const tip = tipIn(document.body) as HTMLElement;
      await user.pointer({ target: tip, keys: "[MouseLeft>]" });
      await user.unhover(tip);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(tipIn(document.body)).not.toBeNull();

      act(() => selectTipText());
      await user.pointer({ keys: "[/MouseLeft]" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(tipIn(document.body)).not.toBeNull();
    });

    it("closes once the press ends with nothing selected and the pointer is away", async () => {
      const { user } = open();
      await restOn(user, screen.getByTestId("anchor"));
      const tip = tipIn(document.body) as HTMLElement;
      await user.pointer({ target: tip, keys: "[MouseLeft>]" });
      await user.unhover(tip);
      await user.pointer({ keys: "[/MouseLeft]" });
      await waitFor(() => expect(tipIn(document.body)).toBeNull());
    });

    it("still closes on Escape while its text is selected", async () => {
      const { user } = open();
      await restOn(user, screen.getByTestId("anchor"));
      act(() => selectTipText());
      await user.pointer({
        target: tipIn(document.body) as HTMLElement,
        keys: "[MouseLeft]",
      });
      await user.keyboard("{Escape}");
      expect(tipIn(document.body)).toBeNull();
    });

    it("does not click what the anchor sits in when the tip is pressed", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: the row exists only to catch a click that must not arrive
        // biome-ignore lint/a11y/useKeyWithClickEvents: as above
        <div onClick={onClick}>
          <Tooltip text="Held since Y1 D12">
            <span data-testid="anchor">Alt</span>
          </Tooltip>
        </div>,
      );
      await restOn(user, screen.getByTestId("anchor"));
      await user.click(tipIn(document.body) as HTMLElement);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  it("makes a non-control child reachable only when asked", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip text="Held since Y1 D12" focusable>
          <span data-testid="readout">42 km</span>
        </Tooltip>
        <Tooltip text="Not a stop">
          <span data-testid="plain">7</span>
        </Tooltip>
      </>,
    );
    expect(screen.getByTestId("readout")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("plain")).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(screen.getByTestId("readout")).toHaveFocus();
    expect(tipIn(document.body)).toHaveTextContent("Held since Y1 D12");
  });

  it("opens no tip when a closing dialog hands focus back to the control", () => {
    render(
      <Tooltip text="Dashboard layouts">
        <button type="button">Open</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: /Open/ });
    document.documentElement.setAttribute(FOCUS_RESTORE_ATTRIBUTE, "");
    act(() => button.focus());
    document.documentElement.removeAttribute(FOCUS_RESTORE_ATTRIBUTE);
    expect(tipIn(document.body)).toBeNull();
  });

  it("adds nothing when the child is already named by the same text", () => {
    render(
      <Tooltip text="Close details">
        <button type="button" aria-label="Close details">
          x
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Close details" });
    expect(button).not.toHaveAttribute("aria-description");
  });

  it("passes the child through when there is nothing to say", () => {
    render(
      <Tooltip text={null}>
        <button type="button">Plain</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button).not.toHaveAttribute("data-tooltip");
    expect(button).not.toHaveAttribute("aria-description");
  });

  it("keeps the child's own handlers", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onFocus = vi.fn();
    render(
      <Tooltip text="Go">
        <button type="button" onClick={onClick} onFocus={onFocus}>
          Go
        </button>
      </Tooltip>,
    );
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onFocus).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Tooltip on a touch screen", () => {
  const touch = (user: ReturnType<typeof userEvent.setup>, el: Element) =>
    user.pointer({ keys: "[TouchA]", target: el });

  it("opens on a tap and stays open until a tap elsewhere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip text="Needs a vessel on the pad">
          <button type="button" aria-disabled="true">
            Launch
          </button>
        </Tooltip>
        <p data-testid="elsewhere">Elsewhere</p>
      </>,
    );
    await touch(user, screen.getByRole("button", { name: "Launch" }));
    expect(tipIn(document.body)).toHaveTextContent("Needs a vessel on the pad");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(tipIn(document.body)).not.toBeNull();

    await touch(user, screen.getByTestId("elsewhere"));
    expect(tipIn(document.body)).toBeNull();
  });

  it("opens on a tap of an anchor that takes no focus, as a button does in Safari", async () => {
    const user = userEvent.setup();
    render(<Anchored text="Held since Y1 D12" />);
    const anchor = screen.getByTestId("anchor");
    await touch(user, anchor);
    expect(tipIn(document.body)).toHaveTextContent("Held since Y1 D12");
    expect(anchor).not.toHaveFocus();
    await touch(user, anchor);
    expect(tipIn(document.body)).toBeNull();
  });

  it("closes on a second tap of the anchor, on Escape and on scroll", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Why">
        <button type="button">Go</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    await touch(user, button);
    expect(tipIn(document.body)).not.toBeNull();
    await touch(user, button);
    expect(tipIn(document.body)).toBeNull();

    await touch(user, button);
    await user.keyboard("{Escape}");
    expect(tipIn(document.body)).toBeNull();

    await touch(user, button);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(tipIn(document.body)).toBeNull();
  });

  it("keeps the tip open while the tip itself is tapped", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Copy me">
        <button type="button">Go</button>
      </Tooltip>,
    );
    await touch(user, screen.getByRole("button", { name: "Go" }));
    await touch(user, tipIn(document.body) as HTMLElement);
    expect(tipIn(document.body)).not.toBeNull();
  });

  it("still runs an enabled button's action when it is tapped", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Tooltip text="Settings">
        <button type="button" onClick={onClick}>
          ⚙
        </button>
      </Tooltip>,
    );
    await touch(user, screen.getByRole("button", { name: "⚙" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("leaves a mouse press closing the tip as before", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Why">
        <button type="button">Go</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    await restOn(user, button);
    expect(tipIn(document.body)).not.toBeNull();
    await user.click(button);
    expect(tipIn(document.body)).toBeNull();
  });
});

describe("Tooltip nested in a tipped element", () => {
  it("shows only the inner tip while the pointer is over the inner element", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Launch Pad tiers">
        <div data-testid="cell">
          <Tooltip text="Upgrade unavailable: another vessel is on the launch site.">
            <button type="button" aria-disabled="true">
              Upgrade
            </button>
          </Tooltip>
        </div>
      </Tooltip>,
    );

    await restOn(user, screen.getByTestId("cell"));
    expect(
      [...document.querySelectorAll("[data-tooltip-tip]")].map(
        (t) => t.textContent,
      ),
    ).toEqual(["Launch Pad tiers"]);

    await restOn(user, screen.getByRole("button", { name: "Upgrade" }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("[data-tooltip-tip]")].map(
          (t) => t.textContent,
        ),
      ).toEqual(["Upgrade unavailable: another vessel is on the launch site."]),
    );
  });

  it("shows only the inner tip when the pointer arrives straight on the inner element", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Launch Pad tiers">
        <div>
          <Tooltip text="Upgrade unavailable">
            <button type="button" aria-disabled="true">
              Upgrade
            </button>
          </Tooltip>
        </div>
      </Tooltip>,
    );

    await restOn(user, screen.getByRole("button", { name: "Upgrade" }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("[data-tooltip-tip]")].map(
          (t) => t.textContent,
        ),
      ).toEqual(["Upgrade unavailable"]),
    );
  });
});
