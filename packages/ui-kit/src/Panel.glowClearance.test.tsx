import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel, ScrollArea } from "./Panel";

describe("scroll glow", () => {
  it("never catches a click on a control beneath it", () => {
    const { container } = render(
      <Panel panelTitle="T">
        <ScrollArea>
          <button type="button">row</button>
        </ScrollArea>
      </Panel>,
    );
    const glows = [...container.querySelectorAll("div")].filter(
      (el) => getComputedStyle(el).getPropertyValue("--fit-mask") !== "",
    );
    expect(glows.length).toBeGreaterThanOrEqual(4);
    for (const glow of glows) {
      expect(getComputedStyle(glow).pointerEvents).toBe("none");
    }
  });

  it("keeps a control it scrolls into view clear of the glow at both ends", () => {
    const { container } = render(
      <Panel panelTitle="T">
        <button type="button">row</button>
      </Panel>,
    );
    const glow = [...container.querySelectorAll("div")].find(
      (el) => getComputedStyle(el).getPropertyValue("--fit-mask") !== "",
    ) as HTMLElement;
    const reach = getComputedStyle(glow).height;
    const body = container.querySelector("button")?.closest("div");
    const scrollers = [
      body as HTMLElement,
      ...container.querySelectorAll("[data-scroll-area-inner]"),
    ];
    for (const scroller of scrollers) {
      expect(getComputedStyle(scroller).scrollPaddingBlock).toBe(reach);
    }
  });
});
