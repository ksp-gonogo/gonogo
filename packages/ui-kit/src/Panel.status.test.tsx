import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/** The panel's status announcer: an off-screen `aria-live` region, not a `status`. */
function announcer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-live-region]");
}

/**
 * The panel's stream badge is the widget's to supply, through `panelStatus`;
 * only the per-subject blackout grades arrive from the host, through the store.
 */
describe("Panel stream status", () => {
  it("renders nothing for a healthy stream", () => {
    // A badge present in the normal case teaches the operator to stop seeing it.
    render(<Panel panelTitle="ORBIT" panelStatus="live" />);
    expect(announcer()).toBeEmptyDOMElement();
    expect(document.querySelector("[data-panel-aside-expand]")).toBeNull();
  });

  it("badges the panel for a degraded stream", () => {
    render(<Panel panelTitle="ORBIT" panelStatus="resyncing" />);
    expect(announcer()).toHaveTextContent("SYNCING");
  });

  it("renders nothing when no status is supplied at all", () => {
    // A panel with no widget and no topics reads "unknown" as quiet, not as NO DATA.
    render(<Panel panelTitle="SOURCES">body</Panel>);
    expect(announcer()).toBeEmptyDOMElement();
    expect(document.querySelector("[data-panel-aside-expand]")).toBeNull();
  });

  it("lets a widget suppress its own status with `none`", () => {
    const { rerender } = render(
      <Panel panelTitle="ORBIT" panelStatus="none">
        body
      </Panel>,
    );
    expect(announcer()).toBeEmptyDOMElement();

    rerender(
      <Panel panelTitle="ORBIT" panelStatus="disconnected">
        body
      </Panel>,
    );
    expect(announcer()).toHaveTextContent("OFFLINE");
  });

  it("puts widget badges beside the status badge, not instead of it", () => {
    render(
      <Panel panelTitle="FUEL" panelStatus="held" panelAside={<span>LOW</span>}>
        body
      </Panel>,
    );
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(announcer()).toHaveTextContent("HELD");
  });

  it("announces the first degradation in a region that was mounted, empty, with the header", () => {
    const { rerender } = render(
      <Panel panelTitle="ORBIT" panelStatus="live" />,
    );
    const region = announcer();
    expect(region).toBeEmptyDOMElement();

    rerender(<Panel panelTitle="ORBIT" panelStatus="held" />);

    expect(announcer()).toBe(region);
    expect(region).toHaveTextContent("ORBIT: HELD");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("keeps the announcement outside the aside, so collapsing the aside cannot silence it", () => {
    render(<Panel panelTitle="ORBIT" panelStatus="disconnected" />);
    const region = announcer();
    const aside = document.querySelector("[data-panel-aside-expand]");
    expect(aside).not.toBeNull();
    expect(aside?.contains(region)).toBe(false);
  });

  it("gives a headless panel no status region", () => {
    render(<Panel>body</Panel>);
    expect(announcer()).toBeNull();
  });
});
