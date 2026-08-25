import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * The panel's stream badge is the WIDGET'S to supply, through `panelStatus`.
 *
 * A host-derived version of this used to exist: the dashboard took every topic
 * a widget declared, reduced them to one worst-of value and handed it down. It
 * was withdrawn because one pill cannot say WHICH of five topics is degraded,
 * and because "absent" means opposite things per topic (an empty
 * `vessel.maneuvers` is a normal state, an absent `vessel.orbit` is not), so
 * the aggregate read as a fault where there was none.
 *
 * What these pin is the rendering contract that survived it, which a widget
 * naming one topic of its own still relies on.
 */
describe("Panel stream status", () => {
  it("renders nothing for a healthy stream", () => {
    // The whole point of the null-for-live design: a badge that is present in
    // the normal case teaches the operator to stop seeing it.
    render(<Panel panelTitle="ORBIT" panelStatus="live" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("badges the panel for a degraded stream", () => {
    render(<Panel panelTitle="ORBIT" panelStatus="resyncing" />);
    expect(screen.getByRole("status")).toHaveTextContent("SYNCING");
  });

  it("renders nothing when no status is supplied at all", () => {
    // Panel is used in the settings modal and the station connect view too.
    // Those have no widget and no topics, so "unknown" must read as quiet
    // rather than as an alarming NO DATA.
    render(<Panel panelTitle="SOURCES">body</Panel>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets a widget suppress its own status with `none`", () => {
    const { rerender } = render(
      <Panel panelTitle="ORBIT" panelStatus="none">
        body
      </Panel>,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <Panel panelTitle="ORBIT" panelStatus="disconnected">
        body
      </Panel>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("OFFLINE");
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
    expect(screen.getByRole("status")).toHaveTextContent("STALE");
  });
});
