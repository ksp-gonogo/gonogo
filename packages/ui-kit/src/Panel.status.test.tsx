import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

/**
 * The panel's stream badge comes from the host, not from the widget. These
 * pin the three things that behaviour has to get right, because each one was
 * a live bug in the hand-wired version it replaces.
 */
describe("Panel stream status", () => {
  it("renders nothing when the host reports a healthy stream", () => {
    // The whole point of the null-for-live design: a badge that is present in
    // the normal case teaches the operator to stop seeing it.
    render(
      <Panel.Status status="live">
        <Panel panelTitle="ORBIT">body</Panel>
      </Panel.Status>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("badges the panel when the host reports a degraded stream", () => {
    render(
      <Panel.Status status="resyncing">
        <Panel panelTitle="ORBIT">body</Panel>
      </Panel.Status>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("SYNCING");
  });

  it("renders nothing outside a dashboard, where no host provides a status", () => {
    // Panel is used in the settings modal and the station connect view too.
    // Those have no widget and no topics, so "unknown" must read as quiet
    // rather than as an alarming NO DATA.
    render(<Panel panelTitle="SOURCES">body</Panel>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets a widget suppress or override the host's status", () => {
    const { rerender } = render(
      <Panel.Status status="absent">
        <Panel panelTitle="ORBIT" panelStatus="none">
          body
        </Panel>
      </Panel.Status>,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <Panel.Status status="live">
        <Panel panelTitle="ORBIT" panelStatus="disconnected">
          body
        </Panel>
      </Panel.Status>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("OFFLINE");
  });

  it("puts widget badges beside the status badge, not instead of it", () => {
    render(
      <Panel.Status status="held-stale">
        <Panel panelTitle="FUEL" panelAside={<span>LOW</span>}>
          body
        </Panel>
      </Panel.Status>,
    );
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("STALE");
  });
});
