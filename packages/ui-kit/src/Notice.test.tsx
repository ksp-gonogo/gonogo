import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { Notice } from "./Notice";

/** Every live region inserted under `container`, and whether each arrived already holding words. */
function watchInsertions(container: HTMLElement) {
  const insertedFull: boolean[] = [];
  const filledLater: Element[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (target.closest?.("[data-live-region]")) filledLater.push(target);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const region = node.matches("[data-live-region]")
          ? node
          : node.querySelector("[data-live-region]");
        if (region) insertedFull.push(region.childNodes.length > 0);
      }
    }
  });
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return { insertedFull, filledLater, stop: () => observer.disconnect() };
}

describe("Notice", () => {
  it("announces through a region that was in the document before its words", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const watch = watchInsertions(container);
    render(<Notice title="Throttle limited">Engine 2 is overheating.</Notice>, {
      container,
    });
    await act(async () => {});
    watch.stop();

    const region = container.querySelector("[data-live-region]");
    expect(region).toHaveTextContent(
      "Throttle limited Engine 2 is overheating.",
    );
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(watch.filledLater.length).toBeGreaterThan(0);
  });

  it("follows its words when they change", async () => {
    const { rerender, container } = render(<Notice>First</Notice>);
    await act(async () => {});
    rerender(<Notice>Second</Notice>);
    await act(async () => {});
    expect(container.querySelector("[data-live-region]")).toHaveTextContent(
      "Second",
    );
  });

  it("is an alert that interrupts only when assertive", () => {
    render(<Notice assertive>Abort</Notice>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("brings no live region with a caller's role", async () => {
    const { container } = render(
      <Notice role="group" aria-label="Quarantine">
        Two Uplinks were held back.
      </Notice>,
    );
    await act(async () => {});
    const group = screen.getByRole("group", { name: "Quarantine" });
    expect(group).not.toHaveAttribute("aria-live");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("drops the assertive channel under a caller's role too", () => {
    render(
      <Notice assertive role="group" aria-label="Abort">
        Abort
      </Notice>,
    );
    expect(screen.getByRole("group", { name: "Abort" })).not.toHaveAttribute(
      "aria-live",
    );
  });

  it("has no axe violations named, polite and assertive", async () => {
    const { container } = render(
      <>
        <Notice aria-label="Settings file">Could not be read.</Notice>
        <Notice assertive>Abort</Notice>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
