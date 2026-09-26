import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { contentFitsCentred, Panel } from "./Panel";

describe("contentFitsCentred", () => {
  it("lets centred content overflow its box by up to the room above it on each side", () => {
    // Twr at tiny-2x2: a 24px readout in an 11px box.
    expect(contentFitsCentred(24, 11, 16)).toBe(true);
    // Under the header the room is the body's 8px gap plus the title's empty
    // 8px foot, so 33px of box holds up to 65px of centred content.
    expect(contentFitsCentred(65, 33, 16)).toBe(true);
  });

  it("says content does not fit once centring would push its top into the title", () => {
    // Measured in Chromium: 70px centred in a 33px box put the first line
    // 2.5px into the title's text.
    expect(contentFitsCentred(70, 33, 16)).toBe(false);
    expect(contentFitsCentred(66, 33, 16)).toBe(false);
  });

  it("gives content no overflow allowance where nothing separates it from the edge", () => {
    expect(contentFitsCentred(33, 33, 0)).toBe(true);
    expect(contentFitsCentred(34, 33, 0)).toBe(false);
  });
});

describe("Panel layout modes", () => {
  it("has no axe violations fitted to size", async () => {
    const { container } = render(
      <Panel panelTitle="TWR" fitToSize>
        <span>1.42</span>
      </Panel>,
    );
    expect(container.querySelector("[data-panel-fit-body]")).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it("has no axe violations with a sidebar at either end", async () => {
    const { container } = render(
      <>
        <Panel panelTitle="MAP" panelSidebar={<p>Layers</p>}>
          <p>Diagram</p>
        </Panel>
        <Panel
          panelTitle="PLOT"
          panelSidebar={<p>Series</p>}
          sidebarSide="start"
          sidebarSize="10rem"
        >
          <p>Chart</p>
        </Panel>
      </>,
    );
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(container.querySelectorAll("[data-panel-sidebar]")).toHaveLength(2);
    await expectNoA11yViolations(container);
  });
});
