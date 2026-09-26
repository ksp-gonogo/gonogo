import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/** The panel's status announcer: an off-screen `aria-live` region, not a `status`. */
function announcer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-live-region]");
}

/**
 * The panel's stream badge is the WIDGET'S to supply, through `panelStatus`.
 *
 * A host-derived version of this used to exist over EVERY grade: the dashboard
 * took every topic a widget declared, reduced them to one worst-of value and
 * handed it down. It was withdrawn because one pill cannot say WHICH of five
 * topics is degraded, and because "absent" means opposite things per topic (an
 * empty `vessel.maneuvers` is a normal state, an absent `vessel.orbit` is not),
 * so the aggregate read as a fault where there was none. That withdrawal
 * stands.
 *
 * The two BLACKOUT grades came back on their own terms, through the status
 * store rather than this prop (`useWidgetStreamStatus`): they are stamped per
 * SUBJECT, so the objection above has nothing to bite on. Everything else is
 * still the widget's to supply.
 *
 * What these pin is the rendering contract that survived it, which a widget
 * naming one topic of its own still relies on.
 */
describe("Panel stream status", () => {
  it("renders nothing for a healthy stream", () => {
    // The whole point of the null-for-live design: a badge that is present in
    // the normal case teaches the operator to stop seeing it.
    render(<Panel panelTitle="ORBIT" panelStatus="live" />);
    expect(announcer()).toBeEmptyDOMElement();
    expect(document.querySelector("[data-panel-aside-expand]")).toBeNull();
  });

  it("badges the panel for a degraded stream", () => {
    render(<Panel panelTitle="ORBIT" panelStatus="resyncing" />);
    expect(announcer()).toHaveTextContent("SYNCING");
  });

  it("renders nothing when no status is supplied at all", () => {
    // Panel is used in the settings modal and the station connect view too.
    // Those have no widget and no topics, so "unknown" must read as quiet
    // rather than as an alarming NO DATA.
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
      <Panel
        panelTitle="FUEL"
        panelStatus="held-stale"
        panelAside={<span>LOW</span>}
      >
        body
      </Panel>,
    );
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(announcer()).toHaveTextContent("STALE");
  });

  it("announces the first degradation in a region that was mounted, empty, with the header", () => {
    const { rerender } = render(
      <Panel panelTitle="ORBIT" panelStatus="live" />,
    );
    const region = announcer();
    expect(region).toBeEmptyDOMElement();

    rerender(<Panel panelTitle="ORBIT" panelStatus="held-stale" />);

    expect(announcer()).toBe(region);
    expect(region).toHaveTextContent("ORBIT: STALE");
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
