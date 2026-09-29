import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { contentFits, Panel } from "./Panel";

describe("contentFits", () => {
  it("centres content no taller than the room between the header and the clip edge", () => {
    expect(contentFits(19.2, 22)).toBe(true);
    expect(contentFits(22, 22)).toBe(true);
  });

  it("says content does not fit once it is taller than that room", () => {
    expect(contentFits(22.5, 22)).toBe(false);
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
