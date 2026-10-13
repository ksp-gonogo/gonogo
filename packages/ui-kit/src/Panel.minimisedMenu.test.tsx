import { act, render, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";

/** jsdom never measures, so the header is told it does not fit: the aside collapses behind the summary. */
const pristineRect = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = pristineRect;
});
function collapse(): void {
  Element.prototype.getBoundingClientRect = function measured(this: Element) {
    return { ...pristineRect.call(this), width: 200 } as DOMRect;
  };
}

function box(): HTMLDetailsElement {
  return document.querySelector(
    "[data-panel-aside-expand]",
  ) as HTMLDetailsElement;
}
function summary(): HTMLElement {
  return box().querySelector("summary") as HTMLElement;
}
function focusSummary(): void {
  act(() => summary().focus());
}
/** Enter and Space on a summary are the browser's own activation, which jsdom does not perform, so the press is followed by the click it would make. */
async function activate(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Enter}");
  await user.click(summary());
  focusSummary();
}
function tip(): HTMLElement | null {
  return document.querySelector("[data-tooltip-tip]");
}

function panel() {
  return (
    <PanelStatusStoreProvider>
      <Panel
        panelTitle="CREW"
        panelBadges={[
          { id: "crit", label: "Crew critical", tone: "nogo" },
          { id: "dose", label: "Dose high", tone: "caution" },
        ]}
      >
        body
      </Panel>
    </PanelStatusStoreProvider>
  );
}

describe("the collapsed header's menu", () => {
  it("opens on hover without changing what a screen reader is told", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    const before = {
      open: box().open,
      label: summary().getAttribute("aria-label"),
      description: summary().getAttribute("aria-description"),
    };
    await user.hover(summary());
    expect(box()).toHaveAttribute("data-hovering");
    expect(box().open).toBe(false);
    expect(summary().getAttribute("aria-label")).toBe(before.label);
    expect(summary().getAttribute("aria-description")).toBe(before.description);
    expect(before.open).toBe(false);
  });

  it("closes shortly after the pointer leaves", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    await user.hover(summary());
    expect(box()).toHaveAttribute("data-hovering");
    await user.unhover(summary());
    await waitFor(() => expect(box()).not.toHaveAttribute("data-hovering"));
  });

  it("stays open while the pointer crosses onto the menu", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    await user.hover(summary());
    await user.unhover(summary());
    await user.hover(screen.getByText("Crew critical"));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(box()).toHaveAttribute("data-hovering");
  });

  it("is pinned by a click, which a pointer leave then leaves alone", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    await user.click(summary());
    expect(box().open).toBe(true);
    await user.unhover(summary());
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(box().open).toBe(true);
  });

  it("does not stay up under the pointer after a second click closes it", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    await user.hover(summary());
    await user.click(summary());
    await waitFor(() => expect(box().open).toBe(true));
    await user.click(summary());
    await waitFor(() => expect(box().open).toBe(false));
    expect(box()).not.toHaveAttribute("data-hovering");
  });

  it("opens from the keyboard with Enter and Space, and Escape closes it with focus on the summary", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    focusSummary();
    await activate(user);
    expect(box().open).toBe(true);
    await user.keyboard("{Escape}");
    expect(box().open).toBe(false);
    expect(summary()).toHaveFocus();
    await activate(user);
    expect(box().open).toBe(true);
  });

  it("closes a pinned menu on a press outside it", async () => {
    collapse();
    const user = userEvent.setup();
    render(
      <>
        {panel()}
        <button type="button">elsewhere</button>
      </>,
    );
    await user.click(summary());
    expect(box().open).toBe(true);
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(box().open).toBe(false);
  });

  it("is not opened by a touch", async () => {
    collapse();
    render(panel());
    act(() => {
      summary().dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      box().dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "touch" }),
      );
    });
    expect(box()).not.toHaveAttribute("data-hovering");
  });

  it("describes the summary with every contributor's words, worst first", () => {
    collapse();
    render(panel());
    expect(summary().getAttribute("aria-description")).toBe(
      "critical: Crew critical\ncaution: Dose high",
    );
  });

  it("shows that description as a tip on keyboard focus, never on a hover", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    await user.hover(summary());
    expect(tip()).toBeNull();
    await user.unhover(summary());
    await waitFor(() => expect(box()).not.toHaveAttribute("data-hovering"));
    focusSummary();
    expect(tip()).toHaveTextContent("Crew critical");
    expect(tip()).toHaveTextContent("Dose high");
  });

  it("steps the summary's tip aside while the menu is open", async () => {
    collapse();
    const user = userEvent.setup();
    render(panel());
    focusSummary();
    expect(tip()).not.toBeNull();
    await activate(user);
    expect(tip()).toBeNull();
  });

  it("gives the status pill inside the menu a tip of its own", async () => {
    collapse();
    const user = userEvent.setup();
    render(
      <PanelStatusStoreProvider>
        <Panel panelTitle="ORBIT" panelStatus="held">
          body
        </Panel>
      </PanelStatusStoreProvider>,
    );
    const pill = screen.getByText("HELD");
    expect(pill).toHaveAttribute("data-tooltip");
    expect(pill.getAttribute("data-tooltip")).toContain("HELD");
    await user.click(summary());
  });

  it("has no axe violations hovered, open and with a tip", async () => {
    collapse();
    const user = userEvent.setup();
    const { container } = render(panel());
    await user.hover(summary());
    await expectNoA11yViolations(container);
    await user.click(summary());
    await expectNoA11yViolations(container);
  });

  it("keeps a plain badge outside a store inert", () => {
    collapse();
    render(
      <Panel panelTitle="X" panelAside={<Badge>ok</Badge>}>
        body
      </Panel>,
    );
    expect(summary().getAttribute("aria-description")).toBeNull();
  });
});
