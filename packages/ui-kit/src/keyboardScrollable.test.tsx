import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure";
import { Panel, ScrollArea } from "./Panel";

/** Lay a jsdom scroller out as overflowing, and tell it so the way a browser would. */
function overflow(el: HTMLElement): void {
  for (const [key, value] of Object.entries({
    clientHeight: 100,
    scrollHeight: 300,
    clientWidth: 200,
    scrollWidth: 200,
  })) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

describe("scroll bodies from the keyboard", () => {
  it("puts a panel body in the tab order only while its content overflows", () => {
    const { container } = render(
      <Panel panelTitle="Crew">
        <p>Jebediah</p>
      </Panel>,
    );
    const body = container.querySelector("[data-panel-body]") as HTMLElement;
    expect(body).not.toHaveAttribute("tabindex");

    overflow(body);
    expect(body).toHaveAttribute("tabindex", "0");
  });

  it("does the same for a scroll area", () => {
    const { container } = render(
      <ScrollArea>
        <p>row</p>
      </ScrollArea>,
    );
    const inner = container.querySelector(
      "[data-scroll-area-inner]",
    ) as HTMLElement;
    expect(inner).not.toHaveAttribute("tabindex");
    overflow(inner);
    expect(inner).toHaveAttribute("tabindex", "0");
  });

  it("does the same for a capped disclosure body", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Details" variant="inline">
        <p>long</p>
      </Disclosure>,
    );
    await user.click(screen.getByRole("button", { name: "Details" }));
    const panel = screen.getByRole("group");
    expect(panel).not.toHaveAttribute("tabindex");
    overflow(panel);
    expect(panel).toHaveAttribute("tabindex", "0");
  });

  it("has no axe violations once a body is focusable", async () => {
    const { container } = render(
      <Panel panelTitle="Crew">
        <p>Jebediah</p>
      </Panel>,
    );
    overflow(container.querySelector("[data-panel-body]") as HTMLElement);
    await expectNoA11yViolations(container);
  });
});
